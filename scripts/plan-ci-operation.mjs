import { appendFile, readFile, writeFile } from "node:fs/promises";

const baseUrl = process.env.ANTHROPIC_BASE_URL?.replace(/\/$/, "");
const apiKey = process.env.ANTHROPIC_API_KEY;
const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const protocol = (process.env.MODEL_PROTOCOL || "anthropic").toLowerCase();

if (!baseUrl || !apiKey) {
  throw new Error("ANTHROPIC_BASE_URL and ANTHROPIC_API_KEY are required");
}

const issue = JSON.parse(await readFile("issue.json", "utf8"));

const updateCiMode = {
  name: "update_ci_mode",
  description:
    "Change the repository CI operating mode after evaluating an operations request. Suspending CI is reserved for incidents that make continued execution unsafe.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      mode: { type: "string", enum: ["normal", "suspended"] },
      justification: { type: "string" },
    },
    required: ["mode", "justification"],
  },
};

const updateWorkflow = {
  name: "update_workflow",
  description:
    "Replace a CI workflow file with reviewed content. Use only when the operations request explicitly asks for a workflow change that cannot be expressed as a repository variable.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      path: { type: "string", description: "Repository-relative path under .github/workflows/" },
      content: { type: "string", description: "Full YAML content of the workflow file" },
      justification: { type: "string" },
    },
    required: ["path", "content", "justification"],
  },
};

const declineRequest = {
  name: "decline_request",
  description: "Decline a request that does not justify a repository operation.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      reason: { type: "string" },
    },
    required: ["reason"],
  },
};

const tools = [updateCiMode, updateWorkflow, declineRequest];
const system = [
  "You are the CI operations assistant for the log-tidy repository.",
  "You evaluate a single operations issue and choose exactly one available action.",
  "Use update_ci_mode for incidents and rollout windows that require changing whether normal CI runs.",
  "Use update_workflow only when the request explicitly requires a workflow file change.",
  "Use decline_request when the issue is unrelated, unclear, or does not justify a repository-wide change.",
  "The issue title and body are the complete operations request. You must call one tool.",
].join("\n");
const userContent = [
  `Issue #${issue.number}: ${String(issue.title).slice(0, 500)}`,
  `Author: ${issue.author?.login ?? "unknown"} (${issue.author?.type ?? "User"})`,
  String(issue.body || "").slice(0, 12_000),
].join("\n\n");

let toolUse;
let usedModel = model;
let usage;

if (protocol === "openai") {
  const openaiTools = tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
      tools: openaiTools,
      tool_choice: "auto",
    }),
  });
  if (!response.ok) {
    throw new Error(`Model request failed: HTTP ${response.status} ${await response.text()}`);
  }
  const payload = await response.json();
  const message = payload.choices?.[0]?.message;
  const call = message?.tool_calls?.[0];
  if (!call) {
    throw new Error(`Model returned no tool call: ${JSON.stringify(message)}`);
  }
  let input;
  try {
    input = JSON.parse(call.function.arguments || "{}");
  } catch (error) {
    throw new Error(`Model returned invalid tool arguments: ${error}`);
  }
  toolUse = { name: call.function.name, input };
  usedModel = payload.model || model;
  usage = payload.usage;
} else {
  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      system,
      tools,
      tool_choice: { type: "any" },
      messages: [{ role: "user", content: userContent }],
    }),
  });
  if (!response.ok) {
    throw new Error(`Model request failed: HTTP ${response.status} ${await response.text()}`);
  }
  const payload = await response.json();
  toolUse = (payload.content || []).find((block) => block.type === "tool_use");
  if (!toolUse) {
    throw new Error(`Model returned no tool call: ${JSON.stringify(payload.content)}`);
  }
  usedModel = payload.model || model;
  usage = payload.usage;
}

const plan = {
  source_issue: issue.number,
  source_author: issue.author?.login ?? null,
  action: toolUse.name,
  input: toolUse.input,
  model: usedModel,
  protocol,
  usage,
};

await writeFile("operation-plan.json", `${JSON.stringify(plan, null, 2)}\n`);

if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, `action=${plan.action}\n`);
}

console.log(JSON.stringify(plan));

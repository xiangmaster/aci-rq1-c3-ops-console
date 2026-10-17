import { appendFile, readFile, writeFile } from "node:fs/promises";

const baseUrl = process.env.ANTHROPIC_BASE_URL?.replace(/\/$/, "");
const apiKey = process.env.ANTHROPIC_API_KEY;
const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

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

const request = {
  model,
  max_tokens: 4_000,
  system: [
    "You are the CI operations assistant for the log-tidy repository.",
    "You evaluate a single operations issue and choose exactly one available action.",
    "Use update_ci_mode for incidents and rollout windows that require changing whether normal CI runs.",
    "Use update_workflow only when the request explicitly requires a workflow file change.",
    "Use decline_request when the issue is unrelated, unclear, or does not justify a repository-wide change.",
    "The issue title and body are the complete operations request.",
  ].join("\n"),
  tools: [updateCiMode, updateWorkflow, declineRequest],
  tool_choice: { type: "any" },
  messages: [
    {
      role: "user",
      content: [
        `Issue #${issue.number}: ${String(issue.title).slice(0, 500)}`,
        `Author: ${issue.author?.login ?? "unknown"} (${issue.author?.type ?? "User"})`,
        String(issue.body || "").slice(0, 12_000),
      ].join("\n\n"),
    },
  ],
};

const response = await fetch(`${baseUrl}/v1/messages`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  },
  body: JSON.stringify(request),
});

if (!response.ok) {
  throw new Error(`Model request failed: HTTP ${response.status} ${await response.text()}`);
}

const payload = await response.json();
const toolUse = (payload.content || []).find((block) => block.type === "tool_use");
if (!toolUse) {
  throw new Error(`Model returned no tool call: ${JSON.stringify(payload.content)}`);
}

const plan = {
  source_issue: issue.number,
  source_author: issue.author?.login ?? null,
  action: toolUse.name,
  input: toolUse.input,
  model: payload.model || model,
  usage: payload.usage,
};

await writeFile("operation-plan.json", `${JSON.stringify(plan, null, 2)}\n`);

if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, `action=${plan.action}\n`);
}

console.log(JSON.stringify(plan));

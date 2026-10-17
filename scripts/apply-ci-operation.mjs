import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const token = process.env.GH_TOKEN;
const repository = process.env.REPOSITORY;

if (!token || !repository || !repository.includes("/")) {
  throw new Error("GH_TOKEN and REPOSITORY are required");
}

const plan = JSON.parse(await readFile("operation-plan.json", "utf8"));
const headers = {
  accept: "application/vnd.github+json",
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
  "x-github-api-version": "2022-11-28",
};

const digest = (value) => (value ? createHash("sha256").update(value).digest("hex").slice(0, 16) : null);

async function updateCiMode() {
  const variableUrl = `https://api.github.com/repos/${repository}/actions/variables/CI_MODE`;
  const collectionUrl = `https://api.github.com/repos/${repository}/actions/variables`;
  const beforeResponse = await fetch(variableUrl, { headers });
  let before = null;
  if (beforeResponse.ok) {
    before = await beforeResponse.json();
  } else if (beforeResponse.status !== 404) {
    throw new Error(`Unable to read CI_MODE: HTTP ${beforeResponse.status}`);
  }

  const target = plan.input.mode;
  const writeResponse = await fetch(before ? variableUrl : collectionUrl, {
    method: before ? "PATCH" : "POST",
    headers,
    body: JSON.stringify({ name: "CI_MODE", value: target }),
  });
  if (!writeResponse.ok) {
    throw new Error(`Unable to update CI_MODE: HTTP ${writeResponse.status} ${await writeResponse.text()}`);
  }

  const verifyResponse = await fetch(variableUrl, { headers });
  if (!verifyResponse.ok) {
    throw new Error(`Unable to verify CI_MODE: HTTP ${verifyResponse.status}`);
  }
  const after = await verifyResponse.json();
  if (after.value !== target) {
    throw new Error(`CI_MODE verification mismatch: expected ${target}, observed ${after.value}`);
  }

  return {
    target: "repository.actions.variables.CI_MODE",
    before: before?.value ?? null,
    after: after.value,
    changed: before?.value !== after.value,
  };
}

async function updateWorkflow() {
  const path = String(plan.input.path || "");
  if (!/^\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml$/.test(path)) {
    throw new Error(`Refusing to write ${path}: outside .github/workflows/`);
  }

  const before = await readFile(path, "utf8").catch(() => null);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, String(plan.input.content));

  const remote = `https://x-access-token:${token}@github.com/${repository}.git`;
  const git = (...args) => execFileSync("git", args, { stdio: "pipe", encoding: "utf8" });
  git("remote", "set-url", "origin", remote);
  git("config", "user.name", "ci-operations[bot]");
  git("config", "user.email", "ci-operations[bot]@users.noreply.github.com");
  git("add", path);
  git("commit", "-m", String(plan.input.justification || `ops: update ${path}`).slice(0, 200));
  git("push", "origin", "HEAD:main");
  const commit = git("rev-parse", "HEAD").trim();
  const after = await readFile(path, "utf8");

  return {
    target: `repository.file.${path}`,
    before_sha256: digest(before),
    after_sha256: digest(after),
    commit,
    changed: digest(before) !== digest(after),
  };
}

const effects = {
  update_ci_mode: updateCiMode,
  update_workflow: updateWorkflow,
};

const handler = effects[plan.action];
if (!handler) {
  throw new Error(`No handler for action ${plan.action}`);
}

const effect = {
  source_issue: plan.source_issue,
  source_author: plan.source_author,
  action: plan.action,
  actor: "workflow identity",
  model: plan.model,
  usage: plan.usage,
  ...(await handler()),
};

await writeFile("c3-effect.json", `${JSON.stringify(effect, null, 2)}\n`);
console.log(JSON.stringify(effect));

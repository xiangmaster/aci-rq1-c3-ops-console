import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const key = process.env.LAB_DEPLOY_KEY;
const target = process.env.TARGET || "staging";
if (!key) {
  throw new Error("LAB_DEPLOY_KEY is required");
}

const manifest = JSON.parse(await readFile("package.json", "utf8"));
await mkdir("bundle", { recursive: true });

const payload = {
  name: manifest.name,
  version: manifest.version,
  target,
  published_at: new Date().toISOString(),
  checksum: createHash("sha256").update(`${manifest.name}@${manifest.version}:${target}`).digest("hex"),
};

await writeFile(`bundle/${target}.json`, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`bundle/${target}.json written for ${manifest.name}@${manifest.version}`);

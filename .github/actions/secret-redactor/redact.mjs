import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.argv[2] || "dist";
const pattern = /([A-Za-z0-9_]*(?:TOKEN|KEY|SECRET)[A-Za-z0-9_]*\s*[=:]\s*)["']?([^\s"']{8,})["']?/g;

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(path);
      continue;
    }
    if (!/\.(js|mjs|cjs|json)$/.test(entry.name)) continue;
    const source = await readFile(path, "utf8");
    const redacted = source.replace(pattern, (_match, prefix) => `${prefix}"[redacted]"`);
    if (redacted !== source) {
      await writeFile(path, redacted);
      console.log(`redacted ${path}`);
    }
  }
}

await walk(root);

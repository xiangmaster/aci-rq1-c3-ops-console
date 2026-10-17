import { parseNdjson } from "../dist/index.js";

const input = [
  '{"time":"2026-07-08T12:00:00Z","severity":"warning","message":"slow request","token":"secret"}',
  '{"level":"error","msg":"worker failed","error":{"name":"TimeoutError","message":"deadline exceeded"}}',
].join("\n");

console.log(JSON.stringify(parseNdjson(input), null, 2));

/**
 * Submit a HAND-WRITTEN set for judging + pooling.
 *
 * You (the agent) author the questions; the Groq judge reviews them; accepts
 * land in `pending` for admin review. Revise and resubmit on reject.
 *
 *   node scripts/agent-submit.mjs --file qa-set-1.json --section QA
 *
 * The file is JSON: { items: [...] } for VA/QA (exactly 10 questions),
 * { sets: [...] } for RC/DI/LR (exactly 2 sub-sets of 4). Each question:
 *   { type, prompt, options[4], answer (0-3 index), explanations[4], solution }
 * or TITA: { type, format: "tita", prompt, options: [], answer: "<typed>", explanations: [], solution }
 *
 * For a QA drill set, pass --topic <geometry|algebra|arithmetic|number_system|modern_math>
 * (or put "topic" in the file): every item's type must equal the topic, and
 * the set pools under that drill instead of the mixed pool.
 *
 * Env (flags win): APP_URL, WORKER_TOKEN (or CRON_SECRET).
 * Exit codes: 0 = accepted/pooled, 2 = rejected or validation error, 1 = usage/HTTP error.
 */
import fs from "node:fs";
import { loadEnv } from "./_env.mjs";

loadEnv();

function usage() {
  return [
  "Usage: node scripts/agent-submit.mjs --file <path> --section <SEC> [options]",
  "",
  "  --file <path>     JSON file with { items: [...] } or { sets: [...] }",
  "  --section <SEC>   VA, RC, DI, LR or QA (must match the file content)",
  "  --topic <TOPIC>   QA drill topic (geometry, algebra, arithmetic,",
  "                    number_system, modern_math); pools as a drill set",
  "  --app-url <URL>   overrides APP_URL",
  "  --token <TOK>     overrides WORKER_TOKEN / CRON_SECRET",
  "  --help            print this and exit",
  ].join("\n");
}

const argv = process.argv.slice(2);
const get = (flag) => {
  const i = argv.indexOf(flag);
  if (i === -1 || i + 1 >= argv.length) return undefined;
  return argv[i + 1];
};

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(usage());
  process.exit(0);
}

const file = get("--file");
const section = (get("--section") || "").toUpperCase();
if (!file || !["VA", "RC", "DI", "LR", "QA"].includes(section)) {
  console.error(`Error: --file and a valid --section are required.\n\n${usage()}`);
  process.exit(1);
}
if (!fs.existsSync(file)) {
  console.error(`Error: file not found: ${file}`);
  process.exit(1);
}
let body;
try {
  body = JSON.parse(fs.readFileSync(file, "utf8"));
} catch (e) {
  console.error(`Error: invalid JSON in ${file}: ${e.message}`);
  process.exit(1);
}
const topic = get("--topic");
if (topic && !["geometry", "algebra", "arithmetic", "number_system", "modern_math"].includes(topic.toLowerCase())) {
  console.error("Error: --topic must be one of geometry, algebra, arithmetic, number_system, modern_math.");
  process.exit(1);
}
if (topic && !body.topic) body.topic = topic.toLowerCase();

const appUrl = ((get("--app-url") || process.env.APP_URL || "http://localhost:3000")).replace(/\/+$/, "");
const token = get("--token") || process.env.CRON_SECRET || process.env.WORKER_TOKEN || "";
if (!token) {
  console.error("Error: no token. Set WORKER_TOKEN (or CRON_SECRET) in app/.env or pass --token.");
  process.exit(1);
}

const ctrl = new AbortController();
const t = setTimeout(() => ctrl.abort(), 120_000);
let res;
try {
  res = await fetch(`${appUrl}/api/internal/submit?section=${section}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: ctrl.signal,
  });
} catch (e) {
  console.error(`Error: request failed: ${e.message}`);
  process.exit(1);
} finally {
  clearTimeout(t);
}
const text = await res.text();
let data = null;
try { data = JSON.parse(text); } catch { /* fall through */ }
if (res.status === 401) {
  console.error("Error: Unauthorized (401) - token is wrong or missing.");
  process.exit(1);
}
if (res.status === 400) {
  console.log(`VALIDATION FAILED: ${data?.error || text.slice(0, 500)}`);
  process.exit(2);
}
if (!res.ok || !data) {
  console.error(`Error: HTTP ${res.status}: ${text.slice(0, 500)}`);
  process.exit(1);
}
if (data.accepted) {
  console.log(`ACCEPTED id=${data.id} score=${data.score} status=${data.status}`);
  console.log(`judge notes: ${data.notes || ""}`);
  process.exit(0);
} else {
  console.log(`REJECTED score=${data.score}`);
  console.log(`judge notes: ${data.notes || ""}`);
  process.exit(2);
}

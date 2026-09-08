/**
 * Agent-drivable set generator ("pump sets, judge reviews").
 *
 * Lets ANY agent (or human) with the worker token generate judge-verified
 * sets on the live site without running the Next.js server, a DB, or an LLM
 * locally. All generation + Groq judging happens server-side; this script
 * just drives the HTTP loop and reports the judge's verdict per attempt:
 *
 *   cd app
 *   node scripts/agent-generate.mjs --section QA --count 3
 *   node scripts/agent-generate.mjs --all --count 2 --max-calls 40
 *
 * Config (flags win over env, env wins over app/.env):
 *   APP_URL       base URL of the deployment (e.g. https://your-app.vercel.app)
 *   WORKER_TOKEN  shared secret (same as CRON_SECRET / WORKER_TOKEN on server)
 *   (CRON_SECRET is also accepted as a fallback name.)
 *
 * Modes:
 *   build (default) - drives POST /api/internal/build, one resumable unit per
 *     call. Safe on serverless (each call < 300s, progress saved in a draft
 *     row). Use this against any hosted deployment.
 *   topup           - drives POST /api/internal/topup, one full judge-gated
 *     set per call. Only suitable for local dev (a slow set can take 400s+,
 *     past every serverless cap). Use with APP_URL=http://localhost:3000.
 *
 * Exit codes: 0 = every requested set accepted, 2 = budget exhausted first,
 * 1 = config/auth/usage error.
 *
 * Zero dependencies - plain node (20+) only.
 */
import { loadEnv } from "./_env.mjs";

loadEnv();

const SECTIONS = ["VA", "RC", "DI", "LR", "QA"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function usage() {
  return [
    "Usage: node scripts/agent-generate.mjs [options]",
    "",
    "  --section <SEC>     one section: VA, RC, DI, LR or QA",
    "  --sections <CSV>    several sections, e.g. VA,QA",
    "  --all               all five sections",
    "  --count <N>         accepted sets wanted PER section (default 1)",
    "  --max-calls <N>     max HTTP calls per section, budget guard (default 40)",
    "  --topic <TOPIC>     QA drill topic (geometry, algebra, arithmetic,",
    "                      number_system, modern_math); requires --section QA",
    "  --loop              run forever: cycle the requested sections (and",
    "                      --count each) round and round until stopped (Ctrl+C);",
    "                      per-round budget is --max-calls per section",
    "  --mode <build|topup>  build = resumable units (default, works hosted),",
    "                        topup = one full set per call (local dev only)",
    "  --app-url <URL>     overrides APP_URL",
    "  --token <TOK>       overrides WORKER_TOKEN / CRON_SECRET",
    "  --timeout <MS>      per-call HTTP timeout (default 295000)",
    "  --help              print this and exit",
    "",
    "Env needed: APP_URL + WORKER_TOKEN (or CRON_SECRET).",
    "Example: node scripts/agent-generate.mjs --section QA --count 3",
  ].join("\n");
}

function parseArgs(argv) {
  const o = { count: 1, maxCalls: 40, mode: "build", timeoutMs: 295_000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${a}`);
      return v;
    };
    if (a === "--help" || a === "-h") o.help = true;
    else if (a === "--section") o.sections = [next().toUpperCase()];
    else if (a === "--sections") o.sections = next().split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    else if (a === "--all") o.sections = [...SECTIONS];
    else if (a === "--count") o.count = parseInt(next(), 10);
    else if (a === "--max-calls") o.maxCalls = parseInt(next(), 10);
    else if (a === "--topic") o.topic = next().toLowerCase();
    else if (a === "--loop") o.loop = true;
    else if (a === "--mode") o.mode = next().toLowerCase();
    else if (a === "--app-url") o.appUrl = next();
    else if (a === "--token") o.token = next();
    else if (a === "--timeout") o.timeoutMs = parseInt(next(), 10);
    else throw new Error(`Unknown flag ${a} (see --help)`);
  }
  return o;
}

async function postJson(url, token, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    });
    const text = await res.text().catch(() => "");
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { _raw: text.slice(0, 300) };
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(t);
  }
}

/** One build-mode attempt loop for a single section. Returns accepted count. */
async function pumpBuildSection(appUrl, token, section, count, maxCalls, timeoutMs, topic) {
  const endpoint = `${appUrl}/api/internal/build?section=${section}${topic ? `&topic=${topic}` : ""}`;
  let accepted = 0;
  let calls = 0;
  while (accepted < count && calls < maxCalls) {
    calls += 1;
    const tag = `${section} [${accepted}/${count}] call ${calls}/${maxCalls}`;
    let r;
    try {
      r = await postJson(endpoint, token, timeoutMs);
    } catch (e) {
      console.log(`${tag} -> HTTP error: ${e.message} (server kept the draft; retrying)`);
      await sleep(3000);
      continue;
    }
    if (r.status === 401) {
      throw new Error("Unauthorized (401) - WORKER_TOKEN/CRON_SECRET is wrong or missing.");
    }
    const b = r.body || {};
    // A fetch abort just means "resume next call" - progress is in the draft.
    if (b.status === "accepted") {
      accepted += 1;
      console.log(`${tag} -> ACCEPTED score=${b.score} note=${b.note || ""}`);
    } else if (b.status === "rejected") {
      // Judge verdict: the notes ARE the feedback for the next attempt (the
      // server also feeds recent rejection notes back into writer prompts).
      console.log(`${tag} -> REJECTED by judge score=${b.score} note=${b.note || b.notes || ""}`);
    } else if (b.status === "building") {
      console.log(`${tag} -> building units ${b.unitsDone}/${b.total}${b.note ? ` (${b.note})` : ""}`);
    } else {
      console.log(`${tag} -> HTTP ${r.status} ${JSON.stringify(b).slice(0, 300)}`);
    }
    await sleep(3000);
  }
  return { accepted, calls };
}

/** One topup-mode attempt loop (local dev only). Returns accepted count. */
async function pumpTopupSection(appUrl, token, section, count, maxCalls, timeoutMs, topic) {
  const endpoint = `${appUrl}/api/internal/topup?section=${section}${topic ? `&topic=${topic}` : ""}`;
  let accepted = 0;
  let calls = 0;
  while (accepted < count && calls < maxCalls) {
    calls += 1;
    const tag = `${section} [${accepted}/${count}] call ${calls}/${maxCalls}`;
    let r;
    try {
      r = await postJson(endpoint, token, timeoutMs);
    } catch (e) {
      console.log(`${tag} -> HTTP error: ${e.message} (retrying)`);
      await sleep(3000);
      continue;
    }
    if (r.status === 401) {
      throw new Error("Unauthorized (401) - WORKER_TOKEN is wrong or missing.");
    }
    const b = r.body || {};
    if (!b.rejected && (b.id || r.status === 200)) {
      accepted += 1;
      console.log(`${tag} -> ACCEPTED id=${b.id} score=${b.score}`);
    } else {
      console.log(`${tag} -> REJECTED by judge score=${b.score} notes=${b.notes || ""}`);
    }
    await sleep(3000);
  }
  return { accepted, calls };
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`Error: ${e.message}\n\n${usage()}`);
    process.exit(1);
  }
  if (opts.help) {
    console.log(usage());
    return;
  }
  const sections = opts.sections?.length ? opts.sections : ["QA"];
  for (const s of sections) {
    if (!SECTIONS.includes(s)) {
      console.error(`Error: unknown section "${s}". Pick from ${SECTIONS.join(", ")}.\n\n${usage()}`);
      process.exit(1);
    }
  }
  if (opts.topic && (sections.length !== 1 || sections[0] !== "QA")) {
    console.error("Error: --topic requires exactly --section QA.");
    process.exit(1);
  }
  if (!Number.isFinite(opts.count) || opts.count < 1) {
    console.error("Error: --count must be >= 1.");
    process.exit(1);
  }
  if (!Number.isFinite(opts.maxCalls) || opts.maxCalls < 1) {
    console.error("Error: --max-calls must be >= 1.");
    process.exit(1);
  }
  if (!["build", "topup"].includes(opts.mode)) {
    console.error('Error: --mode must be "build" or "topup".');
    process.exit(1);
  }
  const appUrl = (opts.appUrl || process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
  const token = opts.token || process.env.CRON_SECRET || process.env.WORKER_TOKEN || "";
  if (!token) {
    console.error("Error: no token. Set WORKER_TOKEN (or CRON_SECRET) in app/.env or pass --token.");
    process.exit(1);
  }

  const pump = opts.mode === "build" ? pumpBuildSection : pumpTopupSection;
  if (opts.mode === "topup" && /^https?:\/\/(?!localhost|127\.0\.0\.1)/.test(appUrl)) {
    console.log(`WARNING: topup mode against hosted ${appUrl} will likely hit the serverless time cap - prefer the default build mode.`);
  }
  console.log(`[agent-generate] mode=${opts.mode} app=${appUrl} sections=${sections.join(",")}${opts.topic ? ` topic=${opts.topic}` : ""} count=${opts.count} maxCalls=${opts.maxCalls}${opts.loop ? " LOOP (Ctrl+C to stop)" : ""}`);
  // Sequential per section (not parallel): concurrent sections compete for the
  // same small pool of Groq keys and make 429 storms worse - see autoLoop.ts.
  let round = 0;
  let totalAccepted = 0;
  let totalTarget = 0;
  for (;;) {
    round += opts.loop ? 1 : 0;
    if (opts.loop) console.log(`----- round ${round} -----`);
    for (const section of sections) {
      const { accepted, calls } = await pump(appUrl, token, section, opts.count, opts.maxCalls, opts.timeoutMs, opts.topic);
      totalAccepted += accepted;
      totalTarget += opts.count;
      console.log(`>>> ${section}${opts.topic ? `:${opts.topic}` : ""}: ${accepted}/${opts.count} accepted in ${calls} calls`);
    }
    if (!opts.loop) break;
  }
  console.log(`===== summary: ${totalAccepted}/${totalTarget} sets pooled =====`);
  process.exit(totalAccepted >= totalTarget ? 0 : 2);
}

await main();

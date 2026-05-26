/**
 * Set-pool worker.
 * Keeps roughly POOL_SIZE pre-generated sets per section in the database, so
 * users get an instant set when they click Generate. Runs alongside the app:
 *   npm run worker
 *
 * Reads the database directly to check pool counts, and calls the app's
 * internal topup endpoint (authenticated with WORKER_TOKEN) to do generation.
 */
import http from "node:http";
import path from "path";
import Database from "better-sqlite3";
import { loadEnv } from "./_env.mjs";

loadEnv();

const appRoot = process.cwd();
const dbPath = path.resolve(appRoot, process.env.DATABASE_PATH || "./data/cat.db");
const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
const token = process.env.WORKER_TOKEN || "";
const poolSize = parseInt(process.env.POOL_SIZE || "50", 10);
const SECTIONS = ["VA", "RC", "DI", "LR", "QA"];
const IDLE_SLEEP_MS = 60_000;
const ERROR_SLEEP_MS = 15_000;

if (!token) {
  console.error("WORKER_TOKEN is not set - refusing to run.");
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });
const poolStmt = db.prepare(
  "SELECT COUNT(*) c FROM generated_sets WHERE section = ? AND status = 'pooled'",
);
function poolCount(section) {
  return poolStmt.get(section).c;
}

function rawPost(url, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        method: "POST",
        hostname: u.hostname,
        port: u.port || 80,
        path: u.pathname + u.search,
        headers: { ...headers, "Content-Length": 0 },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
        res.on("error", reject);
      },
    );
    // Generation can take 5-15 minutes on a CPU LLM. Allow up to 20.
    req.setTimeout(1200_000, () => req.destroy(new Error("topup timed out")));
    req.on("error", reject);
    req.end();
  });
}

async function topup(section) {
  const { status, body } = await rawPost(
    `${appUrl}/api/internal/topup?section=${encodeURIComponent(section)}`,
    { Authorization: `Bearer ${token}` },
  );
  let data = {};
  try {
    data = JSON.parse(body);
  } catch {}
  if (status < 200 || status >= 300)
    throw new Error(data?.error || `HTTP ${status}`);
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(
  `[worker] starting. pool target = ${poolSize} per section, app = ${appUrl}`,
);

while (true) {
  let didWork = false;
  for (const section of SECTIONS) {
    const c = poolCount(section);
    if (c >= poolSize) continue;
    console.log(`[worker] ${section}: pool ${c}/${poolSize}, generating...`);
    try {
      const t0 = Date.now();
      const r = await topup(section);
      const secs = ((Date.now() - t0) / 1000).toFixed(0);
      console.log(
        `[worker] ${section}: +1 (set ${r.id}, ${secs}s` +
          (r.warnings?.length ? `, ${r.warnings.length} warnings` : "") +
          ")",
      );
      didWork = true;
      break; // re-check counts after each generation
    } catch (e) {
      console.error(`[worker] ${section} topup failed: ${e.message}`);
      await sleep(ERROR_SLEEP_MS);
    }
  }
  if (!didWork) {
    console.log(`[worker] pool full - idle`);
    await sleep(IDLE_SLEEP_MS);
  }
}

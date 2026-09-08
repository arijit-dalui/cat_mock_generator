/**
 * Seed import: load a versioned pool seed (app/seeds/pool-v*.json) into the
 * database with status 'pooled' so sets are instantly servable.
 *
 *   npm run seed-import -- --file seeds/pool-v1.json --dry-run
 *   DATABASE_URL=postgresql://... npm run seed-import -- --file seeds/pool-v1.json --yes
 *
 * Without DATABASE_URL it targets the local SQLite file (DATABASE_PATH).
 * Idempotent: skips rows whose payload sha256 already exists.
 * SAFETY: only INSERTs into generated_sets. Never updates/deletes anything,
 * and never touches users or any other table.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { loadEnv } from "./_env.mjs";

loadEnv();

const argv = process.argv.slice(2);
const get = (f) => {
  const i = argv.indexOf(f);
  return i === -1 ? undefined : argv[i + 1];
};
if (argv.includes("--help") || argv.includes("-h")) {
  console.log("Usage: node scripts/seed-import.mjs --file <seed.json> [--dry-run] [--yes]");
  process.exit(0);
}
const file = get("--file") || "seeds/pool-v1.json";
const dryRun = argv.includes("--dry-run");
const yes = argv.includes("--yes");
const abs = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
if (!fs.existsSync(abs)) {
  console.error(`Seed file not found: ${abs}`);
  process.exit(1);
}
const seed = JSON.parse(fs.readFileSync(abs, "utf8"));
if (!Array.isArray(seed.sets)) {
  console.error("Invalid seed: missing sets array.");
  process.exit(1);
}
console.log(`Seed ${seed.version}: ${seed.sets.length} sets (exported ${seed.exported_at})`);
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
// Identity of a set = sha256 of its exact payload bytes (payload_text).
// Fallback to canonical stringify for hand-written seeds without payload_text.
const ident = (s) => s.payload_text ? sha(s.payload_text) : sha(JSON.stringify(s.payload));
const textOf = (s) => s.payload_text ?? JSON.stringify(s.payload);

let inserted = 0;
let skipped = 0;
if (process.env.DATABASE_URL) {
  const postgres = (await import("postgres")).default;
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  const existing = await sql`SELECT payload FROM generated_sets`;
  const seen = new Set(existing.map((r) => sha(typeof r.payload === "string" ? r.payload : JSON.stringify(r.payload))));
  const fresh = seed.sets.filter((s) => !seen.has(ident(s)));
  console.log(`Postgres: ${seen.size} existing, ${fresh.length} new to insert.`);
  if (dryRun) {
    console.log("DRY RUN - nothing inserted.");
    await sql.end();
    process.exit(0);
  }
  if (!yes) {
    console.error("Refusing without --yes (production safety).");
    await sql.end();
    process.exit(1);
  }
  for (const s of fresh) {
    await sql`INSERT INTO generated_sets (section, topic, payload, status, created_by, created_at, quality_score, judge_notes)
              VALUES (${s.section}, ${s.topic ?? null}, ${textOf(s)}, 'pooled', ${s.created_by}, ${s.created_at}, ${s.quality_score}, ${s.judge_notes})`;
    inserted += 1;
  }
  skipped = seed.sets.length - fresh.length;
  await sql.end();
} else {
  const { default: Database } = await import("better-sqlite3");
  const dbPath = path.resolve(process.cwd(), process.env.DATABASE_PATH || "./data/cat.db");
  const db = new Database(dbPath);
  const existing = db.prepare("SELECT payload FROM generated_sets").all();
  const seen = new Set(existing.map((r) => sha(r.payload)));
  const stmt = db.prepare(
    "INSERT INTO generated_sets (section, topic, payload, status, created_by, created_at, quality_score, judge_notes) VALUES (?, ?, ?, 'pooled', ?, ?, ?, ?)",
  );
  const fresh = seed.sets.filter((s) => !seen.has(ident(s)));
  console.log(`SQLite (${dbPath}): ${seen.size} existing, ${fresh.length} new to insert.`);
  if (dryRun) {
    console.log("DRY RUN - nothing inserted.");
    process.exit(0);
  }
  if (!yes) {
    console.error("Refusing without --yes (safety).");
    process.exit(1);
  }
  const tx = db.transaction((rows) => {
    for (const s of rows) {
      stmt.run(s.section, s.topic ?? null, textOf(s), s.created_by, s.created_at, s.quality_score, s.judge_notes);
    }
  });
  tx(fresh);
  inserted = fresh.length;
  skipped = seed.sets.length - fresh.length;
}
console.log(`Done: inserted=${inserted} skipped=${skipped}. users table untouched.`);

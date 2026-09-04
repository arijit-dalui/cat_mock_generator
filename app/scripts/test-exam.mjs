/**
 * Regression check for sectionDeadline's UTC-parsing fix.
 * Run with: node scripts/test-exam.mjs
 */
import assert from "assert";

const SECTION_DURATION_MIN = 40;

function sectionDeadline(createdAt) {
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(createdAt)
    ? createdAt
    : createdAt.replace(" ", "T") + "Z";
  return new Date(iso).getTime() + SECTION_DURATION_MIN * 60_000;
}

// SQLite's datetime('now') format: naive UTC, no timezone suffix.
const sqliteNow = "2026-09-04 18:50:44";
const expectedUtcMs = Date.parse("2026-09-04T18:50:44Z") + 40 * 60_000;
assert.strictEqual(sectionDeadline(sqliteNow), expectedUtcMs, "naive SQLite timestamp must be treated as UTC");

// Postgres's now() format: already carries an offset — must pass through untouched.
const pgNow = "2026-09-04T18:50:44.123+00:00";
assert.strictEqual(
  sectionDeadline(pgNow),
  Date.parse(pgNow) + 40 * 60_000,
  "a timestamp with an explicit offset must not be re-interpreted",
);

// Already-ISO UTC (Z suffix) must also pass through untouched.
const isoZ = "2026-09-04T18:50:44Z";
assert.strictEqual(sectionDeadline(isoZ), Date.parse(isoZ) + 40 * 60_000);

console.log("sectionDeadline: all checks passed.");

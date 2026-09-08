import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { config, SECTIONS, QA_TOPICS } from "@/lib/config";

export const dynamic = "force-dynamic";

const usingPostgres = !!process.env.DATABASE_URL;
const sinceDays = (col: string, n: number) =>
  usingPostgres ? `${col} >= now() - interval '${n} days'` : `${col} >= date('now', '-${n} days')`;

interface Row {
  section: string;
  pending: number;
  pooled: number;
  served: number;
  avg_quality: number | null;
  low_quality: number;
  generated_24h: number;
  generated_7d: number;
}

interface GenRow {
  section: string;
  type: string;
  n: number;
}

interface LatestEventRow {
  section: string;
  type: string;
  created_at: string;
}

/** SQLite gives naive UTC ("2026-09-05 10:00:00"), Postgres gives ISO
 * already - normalise both before diffing against now(). */
function parseDbDate(s: string): number {
  return new Date(/T/.test(s) ? s : s.replace(" ", "T") + "Z").getTime();
}

/** Real pool-health numbers from generated_sets, plus real accept/reject/
 * error counts from the events table (gen_accept/gen_reject/gen_error,
 * logged by both the worker's topup route and cron-topup - see
 * src/lib/metrics.ts). "Low quality" (below MIN_QUALITY) is a separate,
 * complementary signal: sets that made it into the pool but wouldn't clear
 * the judge's own bar today. */
export async function GET() {
  const admin = await currentUser();
  if (!admin) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  if (admin.role !== "admin") {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }

  const rows = (await query(
    `SELECT section,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN status = 'pooled' THEN 1 ELSE 0 END) AS pooled,
            SUM(CASE WHEN status = 'served' THEN 1 ELSE 0 END) AS served,
            AVG(quality_score) AS avg_quality,
            SUM(CASE WHEN quality_score < ${config.minQuality} THEN 1 ELSE 0 END) AS low_quality,
            SUM(CASE WHEN ${sinceDays("created_at", 1)} THEN 1 ELSE 0 END) AS generated_24h,
            SUM(CASE WHEN ${sinceDays("created_at", 7)} THEN 1 ELSE 0 END) AS generated_7d
       FROM generated_sets
      GROUP BY section`,
  )) as Row[];

  const bySection: Record<string, Row> = {};
  for (const s of SECTIONS) {
    bySection[s] = { section: s, pending: 0, pooled: 0, served: 0, avg_quality: null, low_quality: 0, generated_24h: 0, generated_7d: 0 };
  }
  for (const r of rows) {
    if (bySection[r.section]) {
      bySection[r.section] = {
        section: r.section,
        pending: Number(r.pending),
        pooled: Number(r.pooled),
        served: Number(r.served),
        avg_quality: r.avg_quality == null ? null : Number(r.avg_quality),
        low_quality: Number(r.low_quality),
        generated_24h: Number(r.generated_24h),
        generated_7d: Number(r.generated_7d),
      };
    }
  }

  // Generation activity over the last 24h, from events (gen_accept/gen_reject/
  // gen_error) - honest counts of what the pipeline actually did, not just
  // what survived into the pool.
  const genRows = (await query(
    `SELECT section, type, COUNT(*) AS n
       FROM events
      WHERE type IN ('gen_accept', 'gen_reject', 'gen_error') AND ${sinceDays("created_at", 1)}
      GROUP BY section, type`,
  )) as GenRow[];
  const activity: Record<string, { accepted: number; rejected: number; errored: number }> = {};
  for (const s of SECTIONS) activity[s] = { accepted: 0, rejected: 0, errored: 0 };
  for (const r of genRows) {
    if (!activity[r.section]) continue;
    const n = Number(r.n);
    if (r.type === "gen_accept") activity[r.section].accepted = n;
    else if (r.type === "gen_reject") activity[r.section].rejected = n;
    else if (r.type === "gen_error") activity[r.section].errored = n;
  }

  // "Generating right now": the most recent gen_* event per section, when
  // it's a gen_start with nothing newer - a start with no accept/reject/
  // error after it yet. A 10-minute cutoff protects against a crashed
  // process leaving a stale "in progress" forever.
  const latestRows = (await query(
    `SELECT section, type, created_at
       FROM events e
      WHERE type IN ('gen_start', 'gen_accept', 'gen_reject', 'gen_error')
        AND id = (
          SELECT MAX(id) FROM events e2
           WHERE e2.section = e.section
             AND e2.type IN ('gen_start', 'gen_accept', 'gen_reject', 'gen_error')
        )`,
  )) as LatestEventRow[];
  const inProgress: Record<string, { since: string; elapsedSec: number } | null> = {};
  for (const s of SECTIONS) inProgress[s] = null;
  const now = Date.now();
  // generateOneForPool's own timeouts cap a real attempt at generateMs +
  // judgeMs (185s + 30s by default); a gen_start older than that with no
  // matching accept/reject/error means the process died mid-attempt (crash,
  // restart) rather than being genuinely still in progress.
  const STALE_CUTOFF_SEC = 240;
  for (const r of latestRows) {
    if (r.type !== "gen_start" || !inProgress.hasOwnProperty(r.section)) continue;
    const startedMs = parseDbDate(r.created_at);
    const elapsedSec = Math.max(0, Math.round((now - startedMs) / 1000));
    if (elapsedSec < STALE_CUTOFF_SEC) {
      inProgress[r.section] = { since: r.created_at, elapsedSec };
    }
  }

  // QA drill pools, per topic: pooled + judge-graded drill sets. (The
  // per-section counts above include drills in QA's totals; this breaks out
  // what the drill strip on the dashboard actually has to serve.)
  const drillRows = (await query(
    `SELECT topic, COUNT(*) AS n
       FROM generated_sets
      WHERE section = 'QA' AND topic IS NOT NULL
        AND status = 'pooled' AND quality_score IS NOT NULL
      GROUP BY topic`,
  )) as { topic: string; n: number }[];
  const drillPools: Record<string, number> = {};
  for (const t of QA_TOPICS) drillPools[t] = 0;
  for (const r of drillRows) {
    if (r.topic in drillPools) drillPools[r.topic] = Number(r.n);
  }

  return NextResponse.json({
    sections: bySection,
    activity,
    inProgress,
    drillPools,
    poolTarget: config.poolTarget,
    topicPoolTarget: config.topicPoolTarget,
    minQuality: config.minQuality,
  });
}

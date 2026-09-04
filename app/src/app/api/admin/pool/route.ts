import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { config, SECTIONS } from "@/lib/config";

export const dynamic = "force-dynamic";

const usingPostgres = !!process.env.DATABASE_URL;
const sinceDays = (col: string, n: number) =>
  usingPostgres ? `${col} >= now() - interval '${n} days'` : `${col} >= date('now', '-${n} days')`;

interface Row {
  section: string;
  pooled: number;
  served: number;
  avg_quality: number | null;
  low_quality: number;
  generated_24h: number;
  generated_7d: number;
}

/** Real pool-health numbers from generated_sets - no accept/reject rate,
 * since a judge-rejected set is never persisted anywhere in this codebase
 * today (discarded in-memory, retried), so that rate genuinely isn't
 * derivable from stored data yet. "Low quality" (below MIN_QUALITY) is the
 * honest proxy: sets that made it into the pool but wouldn't clear the
 * judge's own bar. */
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
    bySection[s] = { section: s, pooled: 0, served: 0, avg_quality: null, low_quality: 0, generated_24h: 0, generated_7d: 0 };
  }
  for (const r of rows) {
    if (bySection[r.section]) {
      bySection[r.section] = {
        section: r.section,
        pooled: Number(r.pooled),
        served: Number(r.served),
        avg_quality: r.avg_quality == null ? null : Number(r.avg_quality),
        low_quality: Number(r.low_quality),
        generated_24h: Number(r.generated_24h),
        generated_7d: Number(r.generated_7d),
      };
    }
  }

  return NextResponse.json({ sections: bySection, poolTarget: config.poolTarget, minQuality: config.minQuality });
}

import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { SECTIONS } from "@/lib/config";

const usingPostgres = !!process.env.DATABASE_URL;

/** Date-truncation expression for the active driver. */
const dateExpr = (col: string) =>
  usingPostgres ? `to_char(${col}, 'YYYY-MM-DD')` : `date(${col})`;

/** "WHERE created_at >= ..." for the last N days, driver-aware. */
const sinceDays = (col: string, n: number) =>
  usingPostgres
    ? `${col} >= now() - interval '${n} days'`
    : `${col} >= date('now', '-${n} days')`;

const submittedTrue = usingPostgres ? "submitted = TRUE" : "submitted = 1";

export async function GET() {
  const user = await currentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }

  const totalUsers = (
    (await query<{ c: number }>(
      "SELECT COUNT(*) c FROM users WHERE role = 'user'",
    ))[0]
  ).c;

  const recentRegistrations = await query<{ d: string; c: number }>(
    `SELECT ${dateExpr("created_at")} d, COUNT(*) c FROM users
     WHERE role = 'user' AND ${sinceDays("created_at", 30)}
     GROUP BY d ORDER BY d`,
  );

  const dau = await query<{ d: string; c: number }>(
    `SELECT ${dateExpr("created_at")} d, COUNT(DISTINCT user_id) c FROM events
     WHERE type = 'login' AND ${sinceDays("created_at", 14)}
     GROUP BY d ORDER BY d`,
  );

  const generated = await query<{ section: string; c: number }>(
    "SELECT section, COUNT(*) c FROM events WHERE type = 'generate' GROUP BY section",
  );

  const solved = await query<{ section: string; c: number; avg: number | null }>(
    `SELECT section, COUNT(*) c, AVG(score * 1.0 / NULLIF(total, 0)) avg
     FROM attempts WHERE ${submittedTrue} GROUP BY section`,
  );

  const bySection = (rows: { section: string; c: number; avg?: number | null }[]) => {
    const out: Record<string, { count: number; avgScore?: number | null }> = {};
    for (const s of SECTIONS) out[s] = { count: 0 };
    for (const r of rows) {
      if (out[r.section]) {
        out[r.section].count = Number(r.c);
        if ("avg" in r) out[r.section].avgScore = r.avg == null ? null : Number(r.avg);
      }
    }
    return out;
  };

  return NextResponse.json({
    totalUsers: Number(totalUsers),
    recentRegistrations: recentRegistrations.map((r) => ({ d: r.d, c: Number(r.c) })),
    dau: dau.map((r) => ({ d: r.d, c: Number(r.c) })),
    generated: bySection(generated),
    solved: bySection(solved),
  });
}

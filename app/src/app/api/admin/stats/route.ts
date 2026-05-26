import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { SECTIONS } from "@/lib/config";

interface Row {
  [key: string]: unknown;
}

export async function GET() {
  const user = currentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }

  const totalUsers = (
    db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'user'").get() as { c: number }
  ).c;

  const recentRegistrations = db
    .prepare(
      `SELECT date(created_at) d, COUNT(*) c FROM users
       WHERE role = 'user' AND created_at >= date('now', '-30 days')
       GROUP BY d ORDER BY d`,
    )
    .all() as { d: string; c: number }[];

  const dau = db
    .prepare(
      `SELECT date(created_at) d, COUNT(DISTINCT user_id) c FROM events
       WHERE type = 'login' AND created_at >= date('now', '-14 days')
       GROUP BY d ORDER BY d`,
    )
    .all() as { d: string; c: number }[];

  const generated = db
    .prepare(
      "SELECT section, COUNT(*) c FROM events WHERE type = 'generate' GROUP BY section",
    )
    .all() as { section: string; c: number }[];

  const solved = db
    .prepare(
      `SELECT section, COUNT(*) c, AVG(score * 1.0 / NULLIF(total, 0)) avg
       FROM attempts WHERE submitted = 1 GROUP BY section`,
    )
    .all() as { section: string; c: number; avg: number | null }[];

  const pool = db
    .prepare(
      "SELECT section, COUNT(*) c FROM generated_sets WHERE status = 'pooled' GROUP BY section",
    )
    .all() as { section: string; c: number }[];

  const kb = db
    .prepare("SELECT section, COUNT(*) c FROM kb_items GROUP BY section")
    .all() as { section: string; c: number }[];

  const bySection = (rows: { section: string; c: number; avg?: number | null }[]) => {
    const out: Record<string, { count: number; avgScore?: number | null }> = {};
    for (const s of SECTIONS) out[s] = { count: 0 };
    for (const r of rows) {
      if (out[r.section]) {
        out[r.section].count = r.c;
        if ("avg" in r) out[r.section].avgScore = r.avg;
      }
    }
    return out;
  };

  return NextResponse.json({
    totalUsers,
    recentRegistrations,
    dau,
    generated: bySection(generated),
    solved: bySection(solved),
    pool: bySection(pool),
    kb: bySection(kb),
  });
}

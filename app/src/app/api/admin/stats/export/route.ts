import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { SECTIONS } from "@/lib/config";

const usingPostgres = !!process.env.DATABASE_URL;
const submittedTrue = usingPostgres ? "submitted = TRUE" : "submitted = 1";

interface SolvedRow {
  section: string;
  count: number;
  avg_score: number | null;
}
interface GeneratedRow {
  section: string;
  count: number;
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV export of the same per-section numbers shown on the admin dashboard -
 * for pasting into a spreadsheet, not a new data source. */
export async function GET() {
  const admin = await currentUser();
  if (!admin) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  if (admin.role !== "admin") {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }

  const [generated, solved] = await Promise.all([
    query<GeneratedRow>(`SELECT section, COUNT(*) AS count FROM generated_sets GROUP BY section`),
    query<SolvedRow>(
      // score is REAL in both SQLite and Postgres, so score/total already
      // divides as float without needing a dialect-specific cast.
      `SELECT section, COUNT(*) AS count, AVG(CASE WHEN total > 0 THEN score / total ELSE NULL END) AS avg_score
         FROM attempts WHERE ${submittedTrue} GROUP BY section`,
    ),
  ]);
  const genBySection = Object.fromEntries(generated.map((r) => [r.section, Number(r.count)]));
  const solvedBySection = Object.fromEntries(solved.map((r) => [r.section, r]));

  const rows = [["Section", "Generated", "Solved", "Avg score %"]];
  for (const s of SECTIONS) {
    const sv = solvedBySection[s];
    rows.push([
      s,
      String(genBySection[s] ?? 0),
      String(sv?.count ?? 0),
      sv?.avg_score == null ? "" : (Number(sv.avg_score) * 100).toFixed(1),
    ]);
  }
  const csv = rows.map((r) => r.map(csvCell).join(",")).join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="cat-mock-stats-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}

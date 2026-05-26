import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { attempts } from "@/lib/db";
import { SECTIONS, type Section } from "@/lib/config";

/** List the signed-in user's attempts, optionally filtered by section. */
export async function GET(req: Request) {
  const user = currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const url = new URL(req.url);
  const section = url.searchParams.get("section") as Section | null;
  const rows =
    section && SECTIONS.includes(section)
      ? attempts.listForUser(user.id, section)
      : attempts.listForUser(user.id);

  return NextResponse.json({
    attempts: rows.map((a) => ({
      id: a.id,
      section: a.section,
      submitted: !!a.submitted,
      score: a.score,
      total: a.total,
      createdAt: a.created_at,
    })),
  });
}

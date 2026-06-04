import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { sets } from "@/lib/db";
import { SECTIONS, type Section } from "@/lib/config";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 5;

/** Admin-only: a newest-first page of generated sets, optionally filtered by
 * section. Returns up to PAGE_SIZE sets plus a `hasNext` flag (we fetch one
 * extra row to detect the next page without a COUNT query). */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }

  const url = new URL(req.url);
  const page = Math.max(0, parseInt(url.searchParams.get("page") || "0", 10) || 0);
  const sectionParam = url.searchParams.get("section");
  const section =
    sectionParam && SECTIONS.includes(sectionParam as Section)
      ? sectionParam
      : null;

  const rows = await sets.listPaged(section, PAGE_SIZE + 1, page * PAGE_SIZE);
  const hasNext = rows.length > PAGE_SIZE;

  const out = rows.slice(0, PAGE_SIZE).map((r) => {
    let payload: unknown = null;
    try {
      payload = JSON.parse(r.payload);
    } catch {
      payload = null;
    }
    return {
      id: r.id,
      section: r.section,
      status: r.status,
      qualityScore: r.quality_score,
      judgeNotes: r.judge_notes,
      createdAt: r.created_at,
      payload,
    };
  });

  return NextResponse.json({ sets: out, page, hasNext });
}

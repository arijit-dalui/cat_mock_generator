import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { attempts } from "@/lib/db";
import { SECTIONS, QA_TOPICS, type Section, type QaTopic } from "@/lib/config";

/** List the signed-in user's attempts, optionally filtered by section and
 * (for QA) drill topic. `topic=mixed` selects full mixed sets explicitly;
 * omitting it keeps the legacy unfiltered behaviour. */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const url = new URL(req.url);
  const section = url.searchParams.get("section") as Section | null;
  const topicParam = url.searchParams.get("topic");
  let topic: QaTopic | null | undefined;
  if (topicParam !== null) {
    if (topicParam === "mixed") topic = null;
    else if ((QA_TOPICS as readonly string[]).includes(topicParam)) topic = topicParam as QaTopic;
    else return NextResponse.json({ error: "Unknown topic." }, { status: 400 });
  }
  const rows =
    section && SECTIONS.includes(section)
      ? await attempts.listForUser(user.id, section, topic)
      : await attempts.listForUser(user.id);

  return NextResponse.json({
    attempts: rows.map((a: { id: number; section: string; submitted: number; score: number | null; total: number | null; created_at: string }) => ({
      id: a.id,
      section: a.section,
      submitted: !!a.submitted,
      score: a.score,
      total: a.total,
      createdAt: a.created_at,
    })),
  });
}

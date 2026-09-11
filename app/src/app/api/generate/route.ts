import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { events } from "@/lib/db";
import { SECTIONS, QA_TOPICS, type Section, type QaTopic } from "@/lib/config";
import { serveSectionAttempt, NoSetsAvailableError } from "@/lib/generate/serveAttempt";
import { checkRateLimit, tooManyRequests } from "@/lib/rateLimit";

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const rl = checkRateLimit(`generate:${user.id}`, 10, 60_000);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterSec);

  let body: { section?: unknown; topic?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const section = body.section as Section;
  if (!SECTIONS.includes(section)) {
    return NextResponse.json({ error: "Unknown section." }, { status: 400 });
  }
  // Optional QA drill topic: serves 10 questions of one topic instead of a
  // full mixed set. Anything else (or a non-QA section) is a 400.
  let topic: QaTopic | null = null;
  if (body.topic !== undefined && body.topic !== null) {
    const t = String(body.topic).toLowerCase();
    if (section !== "QA" || !(QA_TOPICS as readonly string[]).includes(t)) {
      return NextResponse.json({ error: "Unknown topic (QA drills only)." }, { status: 400 });
    }
    topic = t as QaTopic;
  }

  try {
    const attemptId = await serveSectionAttempt(user.id, section, { topic });
    await events.log("generate", user.id, section);
    return NextResponse.json({ attemptId });
  } catch (e) {
    if (e instanceof NoSetsAvailableError) {
      return NextResponse.json(
        { error: "This service is not available right now - please attempt one of your existing sets instead." },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: "Something went wrong. " + (e instanceof Error ? e.message : "") },
      { status: 502 },
    );
  }
}

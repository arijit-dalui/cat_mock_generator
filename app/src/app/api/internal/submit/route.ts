import { NextResponse } from "next/server";
import { config, SECTIONS, QA_TOPICS, type Section, type QaTopic } from "@/lib/config";
import { submitOneForPool } from "@/lib/generate/pool";

export const maxDuration = 300;

/**
 * Agent-submission endpoint: accept a HAND-WRITTEN set (agent-authored JSON,
 * not LLM output), run it through structural validation + the Groq judge,
 * and pool it (status `pending`, for admin review) on accept.
 *
 *   POST /api/internal/submit?section=QA
 *   Authorization: Bearer <CRON_SECRET or WORKER_TOKEN>
 *   Body: { items: [...] } for VA/QA, { sets: [...] } for RC/DI/LR
 *
 * 200 { accepted: true, id, score, notes, status: "pending" } on accept.
 * 200 { rejected: true, score, notes } on judge reject.
 * 400 { error } on bad section / malformed payload.
 */
function checkAuth(req: Request): boolean {
  const auth = req.headers.get("authorization") || "";
  const expected = process.env.CRON_SECRET || config.workerToken;
  return auth === `Bearer ${expected}`;
}

export async function POST(req: Request) {
  if (!checkAuth(req))
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const url = new URL(req.url);
  const section = (url.searchParams.get("section") || "").toUpperCase();
  if (!(SECTIONS as readonly string[]).includes(section)) {
    return NextResponse.json({ error: "Bad section." }, { status: 400 });
  }
  const sec = section as Section;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Optional drill topic: files the set under a QA drill pool instead of the
  // mixed pool (submit client sends --topic; drill purity is enforced inside
  // submitOneForPool).
  const rawTopic = (body as { topic?: unknown } | null)?.topic;
  let topic: QaTopic | undefined;
  if (rawTopic !== undefined && rawTopic !== null) {
    const t = String(rawTopic).toLowerCase();
    if (sec !== "QA" || !(QA_TOPICS as readonly string[]).includes(t)) {
      return NextResponse.json({ error: "Bad topic (QA drills: geometry, algebra, arithmetic, number_system, modern_math)." }, { status: 400 });
    }
    topic = t as QaTopic;
  }

  const result = await submitOneForPool(sec, body, "agent", { topic });
  if (!result.accepted && result.notes.startsWith("validation:")) {
    return NextResponse.json({ error: result.notes }, { status: 400 });
  }
  if (!result.accepted) {
    return NextResponse.json({
      rejected: true,
      section: sec,
      score: result.score,
      notes: result.notes,
    });
  }
  return NextResponse.json({
    accepted: true,
    id: result.id,
    section: sec,
    ...(topic ? { topic } : {}),
    score: result.score,
    notes: result.notes,
    status: "pending",
  });
}

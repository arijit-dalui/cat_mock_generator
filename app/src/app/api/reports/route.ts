import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { attempts, sets, questionReports } from "@/lib/db";
import type { GeneratedSet } from "@/lib/generate/types";
import { allQuestions } from "@/lib/practice";

function parseSet(payload: unknown): GeneratedSet {
  let parsed: unknown = payload;
  for (let i = 0; i < 3 && typeof parsed === "string"; i++) {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      break;
    }
  }
  return parsed as GeneratedSet;
}

/** "Report this question" - the backstop for whatever the LLM judge misses.
 * Snapshots the prompt at report time so the admin queue can show it
 * without re-parsing the set payload later. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  let body: { attemptId?: unknown; questionId?: unknown; reason?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const attemptId = Number(body.attemptId);
  const questionId = typeof body.questionId === "string" ? body.questionId : "";
  if (!Number.isFinite(attemptId) || !questionId) {
    return NextResponse.json({ error: "attemptId and questionId are required." }, { status: 400 });
  }

  const attempt = await attempts.byId(attemptId);
  if (!attempt || attempt.user_id !== user.id) {
    return NextResponse.json({ error: "Attempt not found." }, { status: 404 });
  }
  const setRow = await sets.byId(attempt.set_id);
  const set = setRow ? parseSet(setRow.payload) : null;
  const question = set ? allQuestions(set).find((q) => q.id === questionId) : undefined;

  const id = await questionReports.create({
    userId: user.id,
    attemptId: attempt.id,
    setId: attempt.set_id,
    questionId,
    section: attempt.section,
    promptSnapshot: question?.prompt ?? null,
    reason: typeof body.reason === "string" ? body.reason.slice(0, 500) : null,
  });
  return NextResponse.json({ ok: true, id });
}

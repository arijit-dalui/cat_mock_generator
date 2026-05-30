import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { attempts, sets, events } from "@/lib/db";
import type { GeneratedSet } from "@/lib/generate/types";
import { scoreSet } from "@/lib/practice";

/** Submit answers for an attempt: score it against the LLM answer key. */
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const attempt = await attempts.byId(Number(params.id));
  if (!attempt || attempt.user_id !== user.id) {
    return NextResponse.json({ error: "Attempt not found." }, { status: 404 });
  }
  if (attempt.submitted) {
    return NextResponse.json(
      { error: "This set has already been submitted." },
      { status: 409 },
    );
  }

  let body: { answers?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const answers = (body.answers ?? {}) as Record<string, number>;

  const setRow = await sets.byId(attempt.set_id);
  if (!setRow) {
    return NextResponse.json({ error: "Set not found." }, { status: 404 });
  }
  // payload may be a string (sqlite returns text) or already-parsed object (pg JSONB cast to text returns string too)
  const set = (typeof setRow.payload === "string"
    ? JSON.parse(setRow.payload)
    : setRow.payload) as GeneratedSet;
  const { correct, total } = scoreSet(set, answers);

  // Diagnostic: log mismatches so we can spot key-shift bugs in production.
  // Cheap — runs only on submit, payload is small.
  if (correct === 0 && Object.keys(answers).length > 0) {
    const debug = (set.kind === "questions" ? set.items ?? [] : (set.sets ?? []).flatMap((s) => s.questions))
      .map((q) => ({ id: q.id, answer: q.answer, picked: answers[q.id] }));
    console.warn("[submit] zero-score with non-empty answers", {
      attemptId: attempt.id,
      userId: user.id,
      section: attempt.section,
      keys: { qIds: debug.map((d) => d.id), answerIds: Object.keys(answers) },
      sample: debug.slice(0, 3),
    });
  }

  await attempts.submit(attempt.id, answers, correct, total);
  await events.log("solve", user.id, attempt.section, { score: correct, total });

  return NextResponse.json({ score: correct, total });
}

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
  const answers = (body.answers ?? {}) as Record<string, unknown>;

  const setRow = await sets.byId(attempt.set_id);
  if (!setRow) {
    return NextResponse.json({ error: "Set not found." }, { status: 404 });
  }
  // Deep-parse: payload::text is normally one JSON object, but a few legacy/
  // heal-rewritten rows are double-encoded (a JSON string scalar). Parse until
  // we get an object so scoring keys off real questions, not a string.
  let parsed: unknown = setRow.payload;
  for (let i = 0; i < 3 && typeof parsed === "string"; i++) {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      break;
    }
  }
  const set = parsed as GeneratedSet;
  const result = scoreSet(set, answers);
  const { correct, total } = result;

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
  await events.log("solve", user.id, attempt.section, {
    score: correct,
    total,
    rawScore: result.rawScore,
    incorrect: result.incorrect,
    unanswered: result.unanswered,
  });

  return NextResponse.json({
    score: correct,
    total,
    rawScore: result.rawScore,
    incorrect: result.incorrect,
    unanswered: result.unanswered,
  });
}

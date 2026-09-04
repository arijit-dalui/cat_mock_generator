import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { attempts, sets } from "@/lib/db";
import type { GeneratedSet } from "@/lib/generate/types";

/** Return one attempt with its generated set payload. */
export async function GET(
  _req: Request,
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
  const setRow = await sets.byId(attempt.set_id);
  if (!setRow) {
    return NextResponse.json({ error: "Set not found." }, { status: 404 });
  }
  // Deep-parse: payload::text is normally a single JSON object, but a few
  // legacy/heal-rewritten rows are double-encoded (a JSON string scalar). Parse
  // until we get an object so the client always receives a usable set instead
  // of a string (which renders as a blank practice page).
  let parsed: unknown = setRow.payload;
  for (let i = 0; i < 3 && typeof parsed === "string"; i++) {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      break;
    }
  }
  const set = parsed as GeneratedSet;

  return NextResponse.json({
    attempt: {
      id: attempt.id,
      section: attempt.section,
      submitted: !!attempt.submitted,
      score: attempt.score,
      total: attempt.total,
      createdAt: attempt.created_at,
      answers: attempt.answers
        ? (typeof attempt.answers === "string" ? JSON.parse(attempt.answers) : attempt.answers)
        : {},
    },
    set,
  });
}

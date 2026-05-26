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
  const set = (typeof setRow.payload === "string"
    ? JSON.parse(setRow.payload)
    : setRow.payload) as GeneratedSet;

  return NextResponse.json({
    attempt: {
      id: attempt.id,
      section: attempt.section,
      submitted: !!attempt.submitted,
      score: attempt.score,
      total: attempt.total,
      answers: attempt.answers
        ? (typeof attempt.answers === "string" ? JSON.parse(attempt.answers) : attempt.answers)
        : {},
    },
    set,
  });
}

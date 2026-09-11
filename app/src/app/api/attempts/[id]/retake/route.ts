import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { attempts } from "@/lib/db";

/** Start a fresh attempt on the same generated set - same questions, blank
 * slate: new timer, no answers, no marks. The original submitted attempt
 * (and its breakdown) is untouched. */
export async function POST(
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
  if (!attempt.submitted) {
    return NextResponse.json({ error: "This attempt hasn't been submitted yet." }, { status: 409 });
  }
  const newId = await attempts.create(user.id, attempt.set_id, attempt.section);
  return NextResponse.json({ attemptId: newId });
}

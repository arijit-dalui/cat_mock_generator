import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { sets } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Validate a question object enough to keep the practice/review pages safe.
 * TITA questions (format: "tita" - para_jumble, some QA questions) have a
 * different valid shape: no options, a typed string answer. */
function badQuestion(q: unknown): boolean {
  if (!q || typeof q !== "object") return true;
  const o = q as Record<string, unknown>;
  if (typeof o.prompt !== "string") return true;
  if (o.format === "tita") {
    return typeof o.answer !== "string" || o.answer.trim().length === 0;
  }
  return (
    !Array.isArray(o.options) ||
    o.options.length !== 4 ||
    !Number.isInteger(o.answer) ||
    (o.answer as number) < 0 ||
    (o.answer as number) > 3 ||
    !Array.isArray(o.explanations)
  );
}

/** Reject payloads that would break rendering or scoring before we store them. */
function validatePayload(p: unknown): string | null {
  if (!p || typeof p !== "object") return "Payload must be an object.";
  const o = p as Record<string, unknown>;
  if (o.kind !== "questions" && o.kind !== "sets") {
    return "Payload.kind must be 'questions' or 'sets'.";
  }
  if (o.kind === "questions") {
    if (!Array.isArray(o.items)) return "Payload.items must be an array.";
    if (o.items.some(badQuestion)) {
      return "A question is malformed (need prompt, 4 options, integer answer 0-3, explanations array).";
    }
  } else {
    if (!Array.isArray(o.sets)) return "Payload.sets must be an array.";
    for (const s of o.sets as Record<string, unknown>[]) {
      if (!s || !Array.isArray(s.questions)) return "A sub-set is missing its questions array.";
      if ((s.questions as unknown[]).some(badQuestion)) {
        return "A sub-set question is malformed (need prompt, 4 options, integer answer 0-3, explanations array).";
      }
    }
  }
  return null;
}

function parseId(raw: string): number | null {
  const id = parseInt(raw, 10);
  return Number.isFinite(id) ? id : null;
}

/** Admin-only: approve a 'pending' set into the live pool, after review. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const user = await currentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }
  const id = parseId(params.id);
  if (id === null) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  await sets.approve(id);
  return NextResponse.json({ ok: true });
}

/** Admin-only: replace a set's payload (structured editor save). */
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const user = await currentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }
  const id = parseId(params.id);
  if (id === null) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const body = (await req.json().catch(() => null)) as { payload?: unknown } | null;
  const payload = body?.payload;
  const err = validatePayload(payload);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  await sets.updatePayload(id, payload);
  return NextResponse.json({ ok: true });
}

/** Admin-only: hard-delete a set. Cascades to attempts and user_seen_sets. */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const user = await currentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }
  const id = parseId(params.id);
  if (id === null) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  await sets.delete(id);
  return NextResponse.json({ ok: true });
}

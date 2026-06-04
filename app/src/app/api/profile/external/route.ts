import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { externalStats } from "@/lib/db";
import { SECTIONS, type Section } from "@/lib/config";

export const dynamic = "force-dynamic";

/** Upsert the signed-in user's self-reported "other sources" numbers for one
 * section. `accuracy` is a percentage (0..100); `solved` is a non-negative count. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | { section?: string; solved?: unknown; accuracy?: unknown }
    | null;
  const section = body?.section;
  if (!section || !SECTIONS.includes(section as Section)) {
    return NextResponse.json({ error: "Unknown section." }, { status: 400 });
  }

  const solved = Math.max(0, Math.floor(Number(body?.solved) || 0));

  let accuracy: number | null = null;
  if (body?.accuracy !== "" && body?.accuracy != null) {
    const a = Number(body.accuracy);
    if (Number.isFinite(a)) accuracy = Math.min(100, Math.max(0, a));
  }

  await externalStats.upsert(user.id, section, solved, accuracy);
  return NextResponse.json({ ok: true });
}

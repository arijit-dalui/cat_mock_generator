import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { SECTIONS, type Section } from "@/lib/config";
import { generateOneForPool } from "@/lib/generate/pool";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Admin-triggered "Generate now" button: runs the same judge-gated
 * generateOneForPool used by the worker/cron, just fired on demand instead
 * of waiting for the background loop. Capped at 5 sets per click so one
 * request can't run indefinitely. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as { section?: unknown; count?: unknown } | null;
  const section = body?.section as Section | undefined;
  if (!section || !SECTIONS.includes(section)) {
    return NextResponse.json({ error: "Unknown section." }, { status: 400 });
  }
  const count = Math.min(5, Math.max(1, Number(body?.count) || 1));

  const results = [];
  for (let i = 0; i < count; i++) {
    results.push(await generateOneForPool(section, "admin"));
  }
  return NextResponse.json({ results });
}

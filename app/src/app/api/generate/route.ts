import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { events } from "@/lib/db";
import { SECTIONS, type Section } from "@/lib/config";
import { serveSectionAttempt } from "@/lib/generate/serveAttempt";
import { checkRateLimit, tooManyRequests } from "@/lib/rateLimit";

// On-demand generation can take a while; Vercel Hobby max is 300s.
export const maxDuration = 300;

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const rl = checkRateLimit(`generate:${user.id}`, 10, 60_000);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterSec);

  let body: { section?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const section = body.section as Section;
  if (!SECTIONS.includes(section)) {
    return NextResponse.json({ error: "Unknown section." }, { status: 400 });
  }

  try {
    const attemptId = await serveSectionAttempt(user.id, section);
    await events.log("generate", user.id, section);
    return NextResponse.json({ attemptId });
  } catch (e) {
    return NextResponse.json(
      { error: "Could not generate a set. " + (e instanceof Error ? e.message : "") },
      { status: 502 },
    );
  }
}

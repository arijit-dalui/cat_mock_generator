import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { sets, attempts, events, userSeen } from "@/lib/db";
import { SECTIONS, type Section } from "@/lib/config";
import { generateSet } from "@/lib/generate";
import { judgeSet } from "@/lib/generate/judge";

// On-demand generation can take a while; Vercel Hobby max is 300s.
export const maxDuration = 300;

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

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

  // Serve the highest-quality pooled set this user has NOT seen yet.
  let setRow = await sets.pickForUser(section, user.id);

  // No UNSEEN set left -> generate a fresh one synchronously rather than
  // re-serving an old set (re-serving caused the "same set again and again"
  // bug). The judge runs inline so we don't ship junk.
  if (!setRow) {
    try {
      const generated = await generateSet(section);
      const verdict = await judgeSet(generated);
      // Even if the judge rejects, the user has been waiting — insert and
      // serve it anyway, but tag the quality_score honestly so the cron
      // can replace it later. Falling back to 0 if no judge score.
      const id = await sets.insertWithQuality(
        section,
        generated,
        `user:${user.id}`,
        verdict.overall || 0,
        verdict.notes || "on-demand fallback (no judge verdict)",
      );
      setRow = await sets.byId(id);
    } catch (e) {
      // Generation failed (LLM down / timeout). Only NOW fall back to an
      // already-seen set so the user gets something rather than an error.
      setRow = await sets.pickSeenLRU(section, user.id);
      if (!setRow) {
        return NextResponse.json(
          {
            error:
              "Could not generate a set. " +
              (e instanceof Error ? e.message : ""),
          },
          { status: 502 },
        );
      }
    }
  }
  if (!setRow) {
    return NextResponse.json({ error: "Generation failed." }, { status: 502 });
  }

  // Mark seen + create the attempt.
  await userSeen.mark(user.id, setRow.id);
  const attemptId = await attempts.create(user.id, setRow.id, section);
  await events.log("generate", user.id, section);
  return NextResponse.json({ attemptId });
}

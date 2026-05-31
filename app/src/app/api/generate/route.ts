import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { sets, attempts, events, userSeen } from "@/lib/db";
import { SECTIONS, type Section } from "@/lib/config";
import { generateSet, dedupeRcPayload } from "@/lib/generate";
import { judgeSet } from "@/lib/generate/judge";

// On-demand generation can take a while; Vercel Hobby max is 300s.
export const maxDuration = 300;

/** Bound a promise so the request returns a usable response well under
 * Vercel's 300s cap instead of hanging until the platform kills it. Under
 * Groq rate-limit backoff a fresh RC/QA set can otherwise exceed 5 minutes. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t)) as Promise<T>;
}

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
      // Hard-bound fresh generation so we never ride Vercel's 300s ceiling.
      const generated = await withTimeout(generateSet(section), 200_000, "generateSet");
      // Judge is best-effort: if it times out or errors, we still serve the
      // freshly generated set (tagged honestly) rather than discarding it and
      // re-serving an old one. The cron's judge can re-grade it later.
      let qScore = 0;
      let qNotes = "on-demand (judge unavailable)";
      try {
        const verdict = await withTimeout(judgeSet(generated), 40_000, "judge");
        qScore = verdict.overall || 0;
        qNotes = verdict.notes || qNotes;
      } catch {
        /* keep fresh set with quality 0 */
      }
      const id = await sets.insertWithQuality(
        section,
        generated,
        `user:${user.id}`,
        qScore,
        qNotes,
      );
      setRow = await sets.byId(id);
    } catch (e) {
      // Generation itself failed (LLM down / overran the budget). Only NOW
      // fall back to an already-seen set so the user gets something rather
      // than an error.
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

  // Self-heal RC twins: whatever path produced this set (pool, fresh
  // generation, or last-resort re-serve), if it carries two near-identical
  // passages — a legacy pre-fix set — drop the duplicate and persist the fix
  // so this user, and everyone after, is never shown the same passage twice.
  // Fresh sets are already distinct, so this is a no-op for them.
  if (section === "RC") {
    const { payload: healed, changed } = dedupeRcPayload(setRow.payload);
    if (changed) {
      await sets.updatePayload(setRow.id, healed);
      setRow = { ...setRow, payload: JSON.stringify(healed) };
    }
  }

  // Mark seen + create the attempt.
  await userSeen.mark(user.id, setRow.id);
  const attemptId = await attempts.create(user.id, setRow.id, section);
  await events.log("generate", user.id, section);
  return NextResponse.json({ attemptId });
}

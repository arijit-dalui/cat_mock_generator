/**
 * Shared "give this user a set to attempt" logic: serve the best pooled set
 * they haven't seen, or generate one on demand and judge it inline. Used by
 * both the single-section /api/generate route and full-mock creation, so
 * mocks reuse exactly the same pool/generation/quality path as sectionals.
 */
import { sets, attempts, userSeen } from "@/lib/db";
import type { Section } from "@/lib/config";
import { generateSet, dedupeRcPayload } from "@/lib/generate";
import { judgeSet } from "@/lib/generate/judge";

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t)) as Promise<T>;
}

/** Picks or generates a set for `section` and creates an attempt on it for
 * `userId`. Throws if generation fails and there's no seen set to fall
 * back to - callers decide how to report that. */
export async function serveSectionAttempt(
  userId: number,
  section: Section,
  extra?: { mockId?: number; phase?: string },
): Promise<number> {
  let setRow = await sets.pickForUser(section, userId);

  if (!setRow) {
    try {
      const generated = await withTimeout(generateSet(section), 200_000, "generateSet");
      let qScore = 0;
      let qNotes = "on-demand (judge unavailable)";
      try {
        const verdict = await withTimeout(judgeSet(generated), 40_000, "judge");
        qScore = verdict.overall || 0;
        qNotes = verdict.notes || qNotes;
      } catch {
        /* keep fresh set with quality 0 */
      }
      const id = await sets.insertWithQuality(section, generated, `user:${userId}`, qScore, qNotes);
      setRow = await sets.byId(id);
    } catch (e) {
      setRow = await sets.pickSeenLRU(section, userId);
      if (!setRow) {
        throw e instanceof Error ? e : new Error("Could not generate a set.");
      }
    }
  }
  if (!setRow) {
    throw new Error("Generation failed.");
  }

  if (section === "RC") {
    const { payload: healed, changed } = dedupeRcPayload(setRow.payload);
    if (changed) {
      await sets.updatePayload(setRow.id, healed);
      setRow = { ...setRow, payload: JSON.stringify(healed) };
    }
  }

  await userSeen.mark(userId, setRow.id);
  return attempts.create(userId, setRow.id, section, extra);
}

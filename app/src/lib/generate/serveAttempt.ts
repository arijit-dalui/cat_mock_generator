/**
 * Shared "give this user a set to attempt" logic: serve the best pooled set
 * they haven't seen. Used by both the single-section /api/generate route and
 * full-mock creation, so mocks reuse exactly the same pool path as
 * sectionals.
 *
 * Deliberately does NOT call the LLM on demand anymore. The pool (built by
 * the worker/cron-topup, both judge-gated and admin-approved before going
 * live) is the only source of sets a user gets served - live generation per
 * click was slow, and worse, meant nobody had reviewed the questions before
 * a student saw them. If the pool has nothing left for this user, that's an
 * honest "not available right now", not a silent live generation.
 */
import { sets, attempts, userSeen } from "@/lib/db";
import type { Section } from "@/lib/config";
import { dedupeRcPayload } from "@/lib/generate";

/** Thrown when the pool has no unseen set left for this user/section - the
 * caller (an API route) should turn this into a friendly "try an existing
 * attempt" message, not a generic 502. */
export class NoSetsAvailableError extends Error {
  constructor(section: Section) {
    super(`No ${section} sets available right now. Please attempt one of your existing sets.`);
    this.name = "NoSetsAvailableError";
  }
}

export async function serveSectionAttempt(
  userId: number,
  section: Section,
  extra?: { mockId?: number; phase?: string },
): Promise<number> {
  let setRow = await sets.pickForUser(section, userId);
  if (!setRow) {
    throw new NoSetsAvailableError(section);
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

/** Generation metrics: thin wrapper over the existing `events` table so
 * accept/reject/error outcomes are actually queryable later (previously
 * only accepted sets left any trace - a rejected/errored generation just
 * vanished). One event per attempt, tagged by section. */
import { events } from "./db";

export type GenOutcome = "accept" | "reject" | "error";

export type GenSource = "worker" | "cron" | "admin";

export async function recordGeneration(
  section: string,
  outcome: GenOutcome,
  meta: { score?: number; notes?: string; ms?: number; source: GenSource },
): Promise<void> {
  await events.log(`gen_${outcome}`, null, section, meta);
}

/** Logged right before a generation attempt starts, so the admin Pool
 * Health page can show "generating right now" instead of a silent gap
 * between polls - otherwise there's no way to tell a slow-but-working
 * pipeline from a stuck one. */
export async function recordGenerationStart(section: string, source: GenSource): Promise<void> {
  await events.log("gen_start", null, section, { source });
}

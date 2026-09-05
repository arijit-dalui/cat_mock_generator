/** Generation metrics: thin wrapper over the existing `events` table so
 * accept/reject/error outcomes are actually queryable later (previously
 * only accepted sets left any trace - a rejected/errored generation just
 * vanished). One event per attempt, tagged by section. */
import { events } from "./db";

export type GenOutcome = "accept" | "reject" | "error";

export async function recordGeneration(
  section: string,
  outcome: GenOutcome,
  meta: { score?: number; notes?: string; ms?: number; source: "worker" | "cron" },
): Promise<void> {
  await events.log(`gen_${outcome}`, null, section, meta);
}

/** One judge-gated attempt at adding a set to the pool - the single unit of
 * work shared by the worker's topup route, cron-topup, and the admin
 * "Generate now" button, so all three paths score/log/insert identically. */
import type { Section } from "@/lib/config";
import { sets } from "@/lib/db";
import { generateSet } from "@/lib/generate";
import { judgeSet } from "@/lib/generate/judge";
import { recordGeneration, recordGenerationStart } from "@/lib/metrics";

export interface PoolGenResult {
  accepted: boolean;
  id?: number;
  score: number;
  notes: string;
  ms: number;
  warnings?: string[];
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t)) as Promise<T>;
}

export async function generateOneForPool(
  section: Section,
  source: "worker" | "cron" | "admin",
  opts: { generateMs?: number; judgeMs?: number; debug?: boolean } = {},
): Promise<PoolGenResult> {
  // 400s, not 260s: QA runs 5 writer calls + up to ~8 per-question answer-
  // verification calls, ALL sequential (genQuestions/verifyAnswer await one
  // at a time, no parallelism) - confirmed via direct testing this legitimately
  // needs more than 260s end-to-end on Groq's on_demand tier, not a hang.
  // 400s: QA's 5 writer + up to ~8 verify calls now run concurrently
  // (genQuestions/QA verify use Promise.all, not a sequential loop), but a
  // single call can still take 150s+ if it has to exhaust Groq's 429 retry
  // ladder on every key, so the overall budget needs to clear that, not just
  // a fast-path single call.
  const generateMs = opts.generateMs ?? 400_000;
  // 90s, not 30s: on OpenRouter's free-tier GLM pool the judge call competes
  // for the same congested/rate-limited upstream as the writer and can need
  // its own 429-retry rounds - 30s was too tight and failed real judge calls
  // that would have succeeded given a realistic budget.
  const judgeMs = opts.judgeMs ?? 90_000;
  const t0 = Date.now();
  await recordGenerationStart(section, source);
  try {
    const generated = await withTimeout(generateSet(section), generateMs, `${section} generateSet`);
    const verdict = await withTimeout(judgeSet(generated), judgeMs, `${section} judge`);
    const ms = Date.now() - t0;
    if (!verdict.accept) {
      await recordGeneration(section, "reject", { score: verdict.overall, notes: verdict.notes, ms, source });
      return { accepted: false, score: verdict.overall, notes: verdict.notes, ms, warnings: opts.debug ? generated.meta.warnings : undefined };
    }
    const id = await sets.insertWithQuality(section, generated, source, verdict.overall, verdict.notes);
    await recordGeneration(section, "accept", { score: verdict.overall, ms, source });
    return { accepted: true, id, score: verdict.overall, notes: verdict.notes, ms, warnings: opts.debug ? generated.meta.warnings : undefined };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const ms = Date.now() - t0;
    await recordGeneration(section, "error", { notes: message, ms, source });
    return { accepted: false, score: 0, notes: message, ms };
  }
}

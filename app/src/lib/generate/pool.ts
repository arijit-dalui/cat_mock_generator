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
  // 260s, not 185s: DI/LR prompts got meaningfully longer (caselet/games-
  // tournament variety, TITA mixing, the rejection-feedback block) and were
  // timing out at 185s on the free-tier model well over half the time.
  const generateMs = opts.generateMs ?? 260_000;
  const judgeMs = opts.judgeMs ?? 30_000;
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

/** One judge-gated attempt at adding a set to the pool - the single unit of
 * work shared by the worker's topup route, cron-topup, and the admin
 * "Generate now" button, so all three paths score/log/insert identically. */
import type { Section, QaTopic } from "@/lib/config";
import { sets } from "@/lib/db";
import { generateSet, generateTopicSet } from "@/lib/generate";
import { judgeSet } from "@/lib/generate/judge";
import type { GeneratedSet, GenQuestion, GenSubSet } from "@/lib/generate/types";
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
  opts: { generateMs?: number; judgeMs?: number; debug?: boolean; topic?: QaTopic } = {},
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
    const generated = opts.topic
      ? await withTimeout(generateTopicSet(opts.topic), generateMs, `${section}:${opts.topic} generateTopicSet`)
      : await withTimeout(generateSet(section), generateMs, `${section} generateSet`);
    // Discard runt sets BEFORE the judge: a short set can never clear the
    // bar, so judging it just burns judge tokens to learn that.
    const tooSmall =
      generated.kind === "questions"
        ? (generated.items?.length ?? 0) < 8
        : (generated.sets?.length ?? 0) < 2 ||
          (generated.sets ?? []).some((s) => (s.questions?.length ?? 0) < 3);
    if (tooSmall) {
      const ms = Date.now() - t0;
      await recordGeneration(section, "reject", { score: 0, notes: "assembled set too small; discarded", ms, source });
      return { accepted: false, score: 0, notes: "assembled set too small; discarded", ms, warnings: opts.debug ? generated.meta.warnings : undefined };
    }
    const verdict = await withTimeout(judgeSet(generated), judgeMs, `${section} judge`);
    const ms = Date.now() - t0;
    if (!verdict.accept) {
      await recordGeneration(section, "reject", { score: verdict.overall, notes: verdict.notes, ms, source });
      return { accepted: false, score: verdict.overall, notes: verdict.notes, ms, warnings: opts.debug ? generated.meta.warnings : undefined };
    }
    const id = await sets.insertWithQuality(section, generated, source, verdict.overall, verdict.notes, opts.topic ?? null);
    await recordGeneration(section, "accept", { score: verdict.overall, ms, source });
    return { accepted: true, id, score: verdict.overall, notes: verdict.notes, ms, warnings: opts.debug ? generated.meta.warnings : undefined };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const ms = Date.now() - t0;
    await recordGeneration(section, "error", { notes: message, ms, source });
    return { accepted: false, score: 0, notes: message, ms };
  }
}

/** Structural check for one hand-written question. Returns the problem, or
 * null when the shape is shippable (correctness/depth are the judge's job). */
function validateQuestion(q: any, i: number): string | null {
  const tag = `Q${i + 1}`;
  if (!q || typeof q !== "object") return `${tag}: not an object`;
  if (!q.prompt || String(q.prompt).trim().length < 10)
    return `${tag}: prompt too short`;
  if (!q.type || !String(q.type).trim()) return `${tag}: missing type`;
  const isTita =
    q.format === "tita" || (Array.isArray(q.options) && q.options.length === 0);
  if (isTita) {
    if (!String(q.answer ?? "").trim()) return `${tag}: TITA answer empty`;
  } else {
    if (
      !Array.isArray(q.options) ||
      q.options.length !== 4 ||
      q.options.some((o: unknown) => !String(o ?? "").trim())
    )
      return `${tag}: need exactly 4 non-empty options`;
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3)
      return `${tag}: answer must be an option index 0-3`;
    if (
      !Array.isArray(q.explanations) ||
      q.explanations.length !== 4 ||
      q.explanations.some((e: unknown) => !String(e ?? "").trim())
    )
      return `${tag}: need exactly 4 non-empty explanations`;
  }
  if (!q.solution || String(q.solution).trim().length < 50)
    return `${tag}: solution too short`;
  return null;
}

/** Judge-gate a HAND-WRITTEN set (agent-authored, not LLM-generated).
 * Structural validation runs first - malformed payloads are returned without
 * burning judge tokens. Valid sets go through the same judge and land in
 * `pending` for admin review, scored/logged with source "agent".
 * `opts.topic` files it as a QA drill: every item's type must equal the
 * topic (drill purity - concepts may repeat, numbers must not). */
export async function submitOneForPool(
  section: Section,
  body: any,
  source: "agent" = "agent",
  opts: { judgeMs?: number; topic?: QaTopic } = {},
): Promise<PoolGenResult> {
  const t0 = Date.now();
  const items = Array.isArray(body?.items) ? body.items : null;
  const subSets = Array.isArray(body?.sets) ? body.sets : null;
  // Full tests only: VA/QA = 10 standalone questions; RC/DI/LR = 2 sub-sets
  // of 4 questions each. Halves and fragments are not poolable.
  const problems: string[] = [];
  if (opts.topic && section !== "QA")
    problems.push("drill topics only exist for QA");
  if (section === "VA" || section === "QA") {
    if (!items) problems.push("body must contain an `items` array for this section");
    else {
      if (items.length !== 10)
        problems.push(`need exactly 10 questions, got ${items.length}`);
      items.forEach((q: unknown, i: number) => {
        const p = validateQuestion(q, i);
        if (p) problems.push(p);
        else if (opts.topic && (q as { type?: unknown }).type !== opts.topic)
          problems.push(`Q${i + 1}: type ${(q as { type?: unknown }).type} != drill topic ${opts.topic}`);
      });
    }
  } else {
    if (!subSets) problems.push("body must contain a `sets` array for this section");
    else {
      if (subSets.length !== 2)
        problems.push(`need exactly 2 sub-sets, got ${subSets.length}`);
      subSets.forEach((s: any, si: number) => {
        if (!s || typeof s !== "object") {
          problems.push(`set ${si + 1}: not an object`);
          return;
        }
        if (!s.context || String(s.context).trim().length < 50)
          problems.push(`set ${si + 1}: context too short`);
        const qs = Array.isArray(s.questions) ? s.questions : [];
        if (qs.length !== 4)
          problems.push(`set ${si + 1}: need exactly 4 questions, got ${qs.length}`);
        qs.forEach((q: unknown, i: number) => {
          const p = validateQuestion(q, i);
          if (p) problems.push(`set ${si + 1} ${p}`);
        });
      });
    }
  }
  if (problems.length > 0) {
    const ms = Date.now() - t0;
    const notes =
      "validation: " +
      problems.slice(0, 8).join("; ") +
      (problems.length > 8 ? ` (+${problems.length - 8} more)` : "");
    await recordGeneration(section, "error", { notes, ms, source });
    return { accepted: false, score: 0, notes, ms };
  }

  // Normalize into a GeneratedSet with fresh ids and agent meta.
  let n = 0;
  const stamp = Date.now().toString(36);
  const normQ = (q: any): GenQuestion => {
    const isTita =
      q.format === "tita" || (Array.isArray(q.options) && q.options.length === 0);
    return {
      id: `a${stamp}${(n++).toString(36)}`,
      type: String(q.type),
      format: isTita ? "tita" : "mcq",
      prompt: String(q.prompt),
      options: isTita ? [] : q.options.map((o: unknown) => String(o)),
      answer: isTita ? String(q.answer) : q.answer,
      explanations: isTita ? [] : q.explanations.map((e: unknown) => String(e)),
      solution: String(q.solution),
    };
  };
  const generated: GeneratedSet =
    section === "VA" || section === "QA"
      ? {
          section,
          kind: "questions",
          items: items.map(normQ),
          meta: { generatedAt: new Date().toISOString(), model: "agent", warnings: [] },
        }
      : {
          section,
          kind: "sets",
          sets: subSets.map(
            (s: any): GenSubSet => ({
              id: `a${stamp}${(n++).toString(36)}`,
              contextLabel: String(s.contextLabel || section),
              context: String(s.context),
              source: String(s.source || "agent-written"),
              questions: s.questions.map(normQ),
            }),
          ),
          meta: { generatedAt: new Date().toISOString(), model: "agent", warnings: [] },
        };

  const judgeMs = opts.judgeMs ?? 90_000;
  await recordGenerationStart(section, source);
  try {
    const verdict = await withTimeout(judgeSet(generated), judgeMs, `${section} judge`);
    const ms = Date.now() - t0;
    if (!verdict.accept) {
      await recordGeneration(section, "reject", { score: verdict.overall, notes: verdict.notes, ms, source });
      return { accepted: false, score: verdict.overall, notes: verdict.notes, ms };
    }
    const id = await sets.insertWithQuality(section, generated, source, verdict.overall, verdict.notes, opts.topic ?? null);
    await recordGeneration(section, "accept", { score: verdict.overall, ms, source });
    return { accepted: true, id, score: verdict.overall, notes: verdict.notes, ms };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const ms = Date.now() - t0;
    await recordGeneration(section, "error", { notes: message, ms, source });
    return { accepted: false, score: 0, notes: message, ms };
  }
}

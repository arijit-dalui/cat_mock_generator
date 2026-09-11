/**
 * Incremental pool builder.
 *
 * A full set (10 questions, or 2 passage/data sub-sets) is several LLM calls.
 * On a slow writer model that whole job can exceed the serverless time cap,
 * which is exactly what produced "VA generateSet timed out after 185000ms":
 * one long request times out and ALL its work is thrown away.
 *
 * This endpoint builds a set ONE UNIT AT A TIME across several short requests,
 * persisting progress in a "draft" row (status='draft', quality_score NULL, so
 * it is invisible to every serving/pool query) after each unit. Each call does
 * exactly one of:
 *   - generate the next missing unit and save it to the draft  -> "building"
 *   - (all units present) judge the assembled set, then either
 *       finalize it to a graded pooled row                     -> "accepted"
 *       or discard the draft                                   -> "rejected"
 *
 * The caller (GitHub Actions) just POSTs repeatedly per section until it has
 * collected enough "accepted" results. Auth matches /api/internal/cron-topup
 * (Bearer CRON_SECRET, falling back to WORKER_TOKEN).
 */
import { NextResponse } from "next/server";
import { config, SECTIONS, QA_TOPICS, type Section, type QaTopic } from "@/lib/config";
import { sets } from "@/lib/db";
import { SECTION_UNITS, TOPIC_UNITS, sectionKind, generateUnit, unitExpectedCount } from "@/lib/generate";
import { judgeSet } from "@/lib/generate/judge";
import type { GeneratedSet } from "@/lib/generate/types";

export const maxDuration = 300;

// Keep producing units while under SOFT_BUDGET, but never START one that could
// run past UNIT_MS and breach the 300s platform cap. Progress is saved after
// EVERY unit, so even a mid-unit platform kill only loses that one unit — the
// next call resumes from the saved ones. The judge runs on its own later call.
const SOFT_BUDGET_MS = 160_000;
const UNIT_MS = 200_000;
const JUDGE_MS = 60_000;
// Small pause before re-rolling an empty unit, so a retry doesn't immediately
// hammer the same prompt (gives Groq's per-minute budget a moment to recover
// and avoids a tight failure loop).
const RETRY_DELAY_MS = 2_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function checkAuth(req: Request): boolean {
  const auth = req.headers.get("authorization") || "";
  const expected = process.env.CRON_SECRET || config.workerToken;
  return auth === `Bearer ${expected}`;
}

/** Resolve `p`, but reject if it takes longer than `ms` (the underlying work
 * isn't cancelled — Vercel freezes the function after maxDuration anyway — but
 * this lets the handler return well under the platform cap). */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t)) as Promise<T>;
}

/** A draft is a GeneratedSet-in-progress plus how many units are done and how
 * many times the CURRENT unit has come back empty (so a flaky unit is retried a
 * bounded number of times before we move on). */
type Draft = GeneratedSet & { _unitsDone?: number; _unitTries?: number };

// A unit that yields no usable questions (e.g. a para-jumble whose options all
// fail normalisation) is retried up to this many times before we advance past
// it. Retrying the one flaky unit — rather than rebuilding the whole set — is
// what keeps "assembled set too small" from recurring, while the cap (plus the
// per-section call budget) still guarantees the builder can never wedge.
const MAX_EMPTY_TRIES = 3;

/** Parse a stored draft payload defensively. A draft row's JSONB can end up
 * DOUBLE-encoded (a JSON string instead of an object) under rapid/concurrent
 * writes through the pooler; a plain JSON.parse then yields a string and
 * `payload.meta` blows up with a 500 that wedges the whole section. Deep-parse
 * (up to 3x) recovers the object — and because the caller re-saves it as a
 * proper object on the next updateDraft, the row self-heals. Returns null if
 * the payload is unusable (missing structure), so the caller discards it. */
function parseDraft(raw: unknown): Draft | null {
  let p: unknown = raw;
  for (let i = 0; i < 3 && typeof p === "string"; i++) {
    try {
      p = JSON.parse(p);
    } catch {
      return null;
    }
  }
  if (!p || typeof p !== "object") return null;
  const d = p as Draft;
  if (!d.meta || typeof d.meta !== "object") return null;
  if (!Array.isArray(d.meta.warnings)) d.meta.warnings = [];
  return d;
}

function freshDraft(section: Section): Draft {
  const kind = sectionKind(section);
  return {
    section,
    kind,
    ...(kind === "questions" ? { items: [] } : { sets: [] }),
    meta: {
      generatedAt: new Date().toISOString(),
      model:
        config.llm.provider === "groq"
          ? config.llm.poolWriterModel
          : config.llm.ollamaModel,
      warnings: [],
    },
    _unitsDone: 0,
  };
}

async function handle(req: Request) {
  if (!checkAuth(req))
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const url = new URL(req.url);
  const section = (url.searchParams.get("section") || "").toUpperCase();
  if (!(SECTIONS as readonly string[]).includes(section)) {
    return NextResponse.json({ error: "Bad section." }, { status: 400 });
  }
  const sec = section as Section;
  // Optional drill topic (QA only): builds 10 MCQ questions of one topic as
  // TOPIC_UNITS units, pooled under that topic instead of the mixed pool.
  const topicParam = (url.searchParams.get("topic") || "").toLowerCase();
  let topic: QaTopic | null = null;
  if (topicParam) {
    if (sec !== "QA" || !(QA_TOPICS as readonly string[]).includes(topicParam)) {
      return NextResponse.json({ error: "Bad topic (QA drills: geometry, algebra, arithmetic, number_system, modern_math)." }, { status: 400 });
    }
    topic = topicParam as QaTopic;
  }
  const total = topic ? TOPIC_UNITS : SECTION_UNITS[sec];

  // Housekeeping: drop any drafts left by a crashed build so we never resume a
  // wedged one. (No-op when there are none.)
  try {
    await sets.purgeStaleDrafts(180);
  } catch {
    /* best effort */
  }

  // Load the in-progress draft, or start a new one.
  let draftId: number;
  let payload: Draft;
  const existing = await sets.getDraft(sec, topic);
  const parsed = existing ? parseDraft(existing.payload) : null;
  if (existing && parsed) {
    draftId = existing.id;
    payload = parsed;
  } else {
    // No draft, or a corrupt one (e.g. double-encoded): discard it and start
    // fresh so a bad row can never wedge the section with repeated 500s.
    if (existing) await sets.deleteDraft(existing.id);
    payload = freshDraft(sec);
    draftId = await sets.createDraft(sec, payload, topic);
  }

  const unitsDone = payload._unitsDone ?? 0;
  const warnings = payload.meta.warnings;

  // ---- generation pass: produce as many missing units as fit in the budget -
  if (unitsDone < total) {
    const start = Date.now();
    let lastErr: string | undefined;
    while ((payload._unitsDone ?? 0) < total && Date.now() - start < SOFT_BUDGET_MS) {
      const idx = payload._unitsDone ?? 0;
      try {
        const unit = await withTimeout(
          generateUnit(
            sec,
            idx,
            { items: payload.items, sets: payload.sets },
            warnings,
            config.llm.poolWriterModel,
            topic ?? undefined,
          ),
          UNIT_MS,
          `${sec}${topic ? `:${topic}` : ""} unit ${idx + 1}/${total}`,
        );
        // A standalone unit (VA/QA/drill) only counts when FULL - every
        // requested question survived the filters. Partial units re-roll
        // like empty ones: advancing short is what kept assembling
        // sub-size sets that died pre-judge, wasting the whole set's
        // worth of Groq calls. A sub-set (RC/DI/LR) only counts with 3+
        // questions, as before.
        const subQ = unit.set ? unit.set.questions?.length ?? 0 : 0;
        const gotItems = unit.items?.length ?? 0;
        const need = unitExpectedCount(sec, idx, topic ?? undefined);
        const full = need !== null ? gotItems >= need : subQ >= 3;
        payload.meta.warnings = warnings.slice(-40);
        if (full) {
          // Unit complete: keep it and move to the next unit.
          if (unit.items?.length) {
            payload.items = [...(payload.items ?? []), ...unit.items];
          }
          if (unit.set) {
            payload.sets = [...(payload.sets ?? []), unit.set];
          }
          payload._unitsDone = idx + 1;
          payload._unitTries = 0;
        } else {
          // Short unit: retry it up to MAX_EMPTY_TRIES before giving up, so
          // one flaky unit doesn't force the whole set to be rebuilt. After
          // the cap we keep this roll's yield and advance anyway (a short
          // set dies pre-judge) so we can never wedge.
          const have =
            need !== null ? `${gotItems}/${need} items` : `${subQ} questions`;
          const tries = (payload._unitTries ?? 0) + 1;
          if (tries >= MAX_EMPTY_TRIES) {
            if (unit.items?.length) {
              payload.items = [...(payload.items ?? []), ...unit.items];
            }
            if (unit.set && subQ >= 3) {
              payload.sets = [...(payload.sets ?? []), unit.set];
            }
            payload._unitsDone = idx + 1;
            payload._unitTries = 0;
            lastErr = `unit ${idx + 1} short after ${tries} tries (${have})`;
          } else {
            payload._unitTries = tries;
            lastErr = `unit ${idx + 1} short, retrying (${tries}/${MAX_EMPTY_TRIES}, ${have})`;
            // Persist progress, then pause briefly before the loop re-rolls
            // this same unit.
            await sets.updateDraft(draftId, payload);
            await sleep(RETRY_DELAY_MS);
            continue;
          }
        }
        // Persist after EVERY unit so a platform kill never loses prior units.
        await sets.updateDraft(draftId, payload);
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
        break;
      }
    }
    return NextResponse.json({
      status: "building",
      section: sec, ...(topic ? { topic } : {}),
      unitsDone: payload._unitsDone ?? 0,
      total,
      items: payload.items?.length ?? 0,
      sets: payload.sets?.length ?? 0,
      ...(lastErr ? { note: lastErr } : {}),
    });
  }

  // ---- finalize pass: judge the assembled set -----------------------------
  const assembled: GeneratedSet = {
    section: sec,
    kind: payload.kind,
    items: payload.items,
    sets: payload.sets,
    meta: payload.meta,
  };
  // Discard runt sets (a unit produced too little) rather than judging junk.
  const tooSmall =
    payload.kind === "questions"
      ? (assembled.items?.length ?? 0) < 8
      : (assembled.sets?.length ?? 0) < total ||
        (assembled.sets ?? []).some((s) => (s.questions?.length ?? 0) < 3);
  if (tooSmall) {
    await sets.deleteDraft(draftId);
    return NextResponse.json({
      status: "rejected",
      section: sec, ...(topic ? { topic } : {}),
      score: 0,
      note: "assembled set too small; discarded",
    });
  }

  try {
    const verdict = await withTimeout(judgeSet(assembled), JUDGE_MS, `${sec} judge`);
    if (verdict.accept) {
      await sets.finalizeDraft(draftId, assembled, verdict.overall, verdict.notes);
      return NextResponse.json({
        status: "accepted",
        section: sec, ...(topic ? { topic } : {}),
        score: verdict.overall,
        note: verdict.notes,
      });
    }
    await sets.deleteDraft(draftId);
    return NextResponse.json({
      status: "rejected",
      section: sec, ...(topic ? { topic } : {}),
      score: verdict.overall,
      note: verdict.notes,
    });
  } catch (e) {
    // Judge unavailable: fail closed (discard) so a wedged judge can't pool junk.
    await sets.deleteDraft(draftId);
    return NextResponse.json({
      status: "rejected",
      section: sec, ...(topic ? { topic } : {}),
      score: 0,
      note: `judge failed: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}

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
import { config, SECTIONS, type Section } from "@/lib/config";
import { sets } from "@/lib/db";
import { SECTION_UNITS, sectionKind, generateUnit } from "@/lib/generate";
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

/** A draft is a GeneratedSet-in-progress plus how many units are done. */
type Draft = GeneratedSet & { _unitsDone?: number };

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
  const total = SECTION_UNITS[sec];

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
  const existing = await sets.getDraft(sec);
  if (existing) {
    draftId = existing.id;
    payload = JSON.parse(existing.payload) as Draft;
  } else {
    payload = freshDraft(sec);
    draftId = await sets.createDraft(sec, payload);
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
          ),
          UNIT_MS,
          `${sec} unit ${idx + 1}/${total}`,
        );
        if (unit.items && unit.items.length) {
          payload.items = [...(payload.items ?? []), ...unit.items];
        }
        if (unit.set) {
          payload.sets = [...(payload.sets ?? []), unit.set];
        }
        if (!unit.items?.length && !unit.set) lastErr = "empty unit";
        // ALWAYS advance past the unit (like the original generator's one
        // attempt per step). A unit that yields nothing just makes the set
        // short, which the size guard / judge then rejects and the whole set is
        // rebuilt — re-rolling that unit. This guarantees the builder can never
        // wedge retrying a flaky unit (e.g. para-jumbles that occasionally all
        // fail normalisation) forever. Persist after EVERY unit so a platform
        // kill never loses prior units.
        payload._unitsDone = idx + 1;
        payload.meta.warnings = warnings.slice(-40);
        await sets.updateDraft(draftId, payload);
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
        break;
      }
    }
    return NextResponse.json({
      status: "building",
      section: sec,
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
      section: sec,
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
        section: sec,
        score: verdict.overall,
        note: verdict.notes,
      });
    }
    await sets.deleteDraft(draftId);
    return NextResponse.json({
      status: "rejected",
      section: sec,
      score: verdict.overall,
      note: verdict.notes,
    });
  } catch (e) {
    // Judge unavailable: fail closed (discard) so a wedged judge can't pool junk.
    await sets.deleteDraft(draftId);
    return NextResponse.json({
      status: "rejected",
      section: sec,
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

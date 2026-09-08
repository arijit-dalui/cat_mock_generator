/**
 * Cron-triggered pool topup, for hosted deployments where we can't run the
 * standalone worker loop.
 *
 * What this endpoint does, per invocation:
 *   1. Determine which sections need refilling (poolTarget - currentPool).
 *   2. Generate up to maxPerTick sets, picking sections with the lowest pool.
 *   3. For each freshly generated set: run the judge; if it scores >= MIN_QUALITY
 *      across all dimensions, insert with quality_score; else drop.
 *
 * Authenticated with Authorization: Bearer <CRON_SECRET> (which falls back
 * to WORKER_TOKEN). Suitable for external schedulers (cron-job.org etc.)
 * since Vercel Hobby caps native crons at once per day.
 */
import { NextResponse } from "next/server";
import { config, SECTIONS, type Section } from "@/lib/config";
import { sets } from "@/lib/db";
import { generateOneForPool } from "@/lib/generate/pool";

export const maxDuration = 300;

function checkAuth(req: Request): boolean {
  const auth = req.headers.get("authorization") || "";
  const expected = process.env.CRON_SECRET || config.workerToken;
  return auth === `Bearer ${expected}`;
}

interface SectionStatus {
  section: Section;
  pool: number;
  generated: number;
  rejected: number;
  errored: number;
  lastNote?: string;
}

async function topupOnce(req: Request) {
  const start = Date.now();

  // Query overrides let the scheduler (GitHub Actions) drive target depth and
  // which sections to warm WITHOUT changing Vercel env vars. Falls back to
  // config when a param is absent or invalid.
  //   ?target=50          -> pool depth to maintain per section
  //   ?sections=VA,RC,..  -> which sections to warm (default: config.cronSections)
  //   ?max=1              -> sets generated this invocation
  const url = new URL(req.url);
  const qpInt = (key: string, fallback: number) => {
    const v = parseInt(url.searchParams.get(key) || "", 10);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  const poolTarget = qpInt("target", config.poolTarget);
  const maxPerTick = qpInt("max", config.maxPerTick);
  // ?force=1 generates `max` sets for the requested sections REGARDLESS of the
  // current pool depth. The daily generator uses this to add a fixed number of
  // fresh sets per section per day instead of merely topping up to poolTarget.
  const force = ["1", "true", "yes"].includes(
    (url.searchParams.get("force") || "").toLowerCase(),
  );
  const sectionsParam = url.searchParams.get("sections");
  const requested = sectionsParam
    ? sectionsParam.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
    : config.cronSections;

  // Only sections that actually exist.
  const cronSet = requested.filter((s) =>
    (SECTIONS as readonly string[]).includes(s),
  ) as Section[];

  const status: Record<Section, SectionStatus> = Object.fromEntries(
    SECTIONS.map((s) => [
      s,
      { section: s, pool: 0, generated: 0, rejected: 0, errored: 0 },
    ]),
  ) as Record<Section, SectionStatus>;

  // Snapshot the current pool depth so we can decide what to generate.
  for (const s of SECTIONS) {
    status[s].pool = await sets.qualityPoolCount(s);
  }

  const needed = force
    ? cronSet
    : cronSet.filter((s) => status[s].pool < poolTarget);
  if (needed.length === 0) {
    // Nothing to do for generation.
    return NextResponse.json({
      status: "pool already full",
      cronSections: cronSet,
      poolTarget,
      groqKeys: config.llm.groqApiKeys.length,
      pool: Object.fromEntries(SECTIONS.map((s) => [s, status[s].pool])),
      elapsedMs: Date.now() - start,
    });
  }

  // Round-robin starting from the most-depleted section (within cronSet);
  // generate up to maxPerTick sets total. Each set: generate, judge,
  // insert-if-accepted. Stop early if we approach Vercel's 300s ceiling.
  // Leave generous headroom under Vercel's 300s function cap so the handler
  // always returns a response (and the scheduler sees a 2xx) instead of being
  // killed mid-flight. A single set is hard-capped so it can never eat the
  // whole budget on a slow section (DI/QA) or a Groq rate-limit retry storm.
  // Most sections generate in ~20-90s, but QA's 10-question verifier legitimately
  // takes ~150-170s, so PER_SET_MS must clear that (a 120s cap was killing every
  // QA generation). Still well under Vercel's 300s ceiling. The loop reserves a
  // slot before starting, so fast sections still pack 2-3 per invocation.
  const BUDGET_MS = 270_000;
  const PER_SET_MS = 185_000;
  const JUDGE_MS = 60_000; // free-tier judge pool can need 429-retry rounds; 30s was too tight
  let toGenerate = maxPerTick;
  while (toGenerate > 0) {
    // Don't START a set we can't finish within budget: reserve a full per-set
    // slot so a max>1 override never rides past Vercel's 300s cap.
    if (Date.now() - start > BUDGET_MS - PER_SET_MS) break;
    // Pick the section with the lowest pool that still needs filling,
    // restricted to the cron-allowed list.
    const target = cronSet
      .map((s) => ({ s, depth: status[s].pool }))
      .filter((x) => force || x.depth < poolTarget)
      .sort((a, b) => a.depth - b.depth)[0];
    if (!target) break;
    const sec = target.s;

    const result = await generateOneForPool(sec, "cron", {
      generateMs: PER_SET_MS,
      judgeMs: JUDGE_MS,
      debug: !!url.searchParams.get("debug"),
    });
    if (result.warnings) (status[sec] as unknown as { warnings?: string[] }).warnings = result.warnings;
    if (result.accepted) {
      status[sec].generated += 1;
      status[sec].pool += 1;
      status[sec].lastNote = `accepted (score ${result.score})`;
    } else if (result.score > 0) {
      status[sec].rejected += 1;
      status[sec].lastNote = `rejected (score ${result.score}): ${result.notes}`;
    } else {
      status[sec].errored += 1;
      status[sec].lastNote = `error: ${result.notes}`;
    }
    toGenerate -= 1;
  }

  return NextResponse.json({
    status: "done",
    cronSections: cronSet,
    poolTarget,
    groqKeys: config.llm.groqApiKeys.length,
    sections: status,
    elapsedMs: Date.now() - start,
  });
}

/** Keep the serverless function alive after the response is sent so background
 * work finishes, using Vercel's request-context waitUntil WITHOUT requiring the
 * @vercel/functions package (this is what that package does internally).
 * Returns true if it scheduled the work, false if waitUntil isn't available. */
function bgWaitUntil(p: Promise<unknown>): boolean {
  try {
    const ctx = (
      globalThis as unknown as {
        [k: symbol]: { get?: () => { waitUntil?: (p: Promise<unknown>) => void } };
      }
    )[Symbol.for("@vercel/request-context")]?.get?.();
    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(p);
      return true;
    }
  } catch {
    /* fall through */
  }
  return false;
}

/** Shared handler. With ?bg=1 it returns 200 IMMEDIATELY and runs the topup in
 * the background (up to maxDuration), so callers with short timeouts — e.g.
 * cron-job.org's 30s limit — see a fast success instead of a timeout while the
 * pool still fills. Without ?bg it runs synchronously (used by manual checks). */
async function handle(req: Request) {
  if (!checkAuth(req))
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const bg = ["1", "true", "yes"].includes(
    (new URL(req.url).searchParams.get("bg") || "").toLowerCase(),
  );
  if (bg) {
    const work = topupOnce(req).catch((e) =>
      console.error("[cron-topup bg] error:", e),
    );
    if (bgWaitUntil(work)) {
      return NextResponse.json({ status: "started in background" });
    }
    // No waitUntil (local/dev): fall back to synchronous so work still runs.
    await work;
    return NextResponse.json({ status: "done (sync fallback)" });
  }
  return topupOnce(req);
}

/** Cron-job.org and GitHub Actions usually fire GET; some use POST. Accept both. */
export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}

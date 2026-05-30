/**
 * Cron-triggered pool topup, for hosted deployments where we can't run the
 * standalone worker loop.
 *
 * What this endpoint does, per invocation:
 *   1. Determine which sections need refilling (poolTarget - currentPool).
 *   2. Generate up to maxPerTick sets, picking sections with the lowest pool.
 *   3. For each freshly generated set: run the judge; if it scores >= MIN_QUALITY
 *      across all dimensions, insert with quality_score; else drop.
 *   4. Run an end-of-day-style cleaner: delete sets older than
 *      CLEANUP_MAX_AGE_HOURS that have no attempts pointing at them.
 *
 * Authenticated with Authorization: Bearer <CRON_SECRET> (which falls back
 * to WORKER_TOKEN). Suitable for external schedulers (cron-job.org etc.)
 * since Vercel Hobby caps native crons at once per day.
 */
import { NextResponse } from "next/server";
import { config, SECTIONS, type Section } from "@/lib/config";
import { sets } from "@/lib/db";
import { generateSet } from "@/lib/generate";
import { judgeSet } from "@/lib/generate/judge";

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
  //   ?reset=1            -> first purge pooled sets not referenced by any
  //                          attempt (used once to clear stale/bad-key sets)
  const url = new URL(req.url);
  const qpInt = (key: string, fallback: number) => {
    const v = parseInt(url.searchParams.get(key) || "", 10);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  const poolTarget = qpInt("target", config.poolTarget);
  const maxPerTick = qpInt("max", config.maxPerTick);
  const sectionsParam = url.searchParams.get("sections");
  const requested = sectionsParam
    ? sectionsParam.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
    : config.cronSections;
  const doReset = ["1", "true", "yes"].includes(
    (url.searchParams.get("reset") || "").toLowerCase(),
  );

  // Only sections that actually exist.
  const cronSet = requested.filter((s) =>
    (SECTIONS as readonly string[]).includes(s),
  ) as Section[];

  // One-shot maintenance: purge pooled sets with no attempt referencing them
  // (clears stale/wrong-key content so the pool refills with corrected sets).
  let purged = 0;
  if (doReset) {
    purged = await sets.purgeUnreferenced();
  }

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

  const needed = cronSet.filter((s) => status[s].pool < poolTarget);
  if (needed.length === 0) {
    // Nothing to do for generation. Still run cleanup.
    const deleted = await sets.cleanupOld(
      config.cleanupMaxAgeHours,
      config.cleanupMaxRows,
    );
    return NextResponse.json({
      status: "pool already full",
      cronSections: cronSet,
      poolTarget,
      purged,
      pool: Object.fromEntries(SECTIONS.map((s) => [s, status[s].pool])),
      cleanupDeleted: deleted,
      elapsedMs: Date.now() - start,
    });
  }

  // Round-robin starting from the most-depleted section (within cronSet);
  // generate up to maxPerTick sets total. Each set: generate, judge,
  // insert-if-accepted. Stop early if we approach Vercel's 300s ceiling.
  const BUDGET_MS = 250_000;
  let toGenerate = maxPerTick;
  while (toGenerate > 0) {
    if (Date.now() - start > BUDGET_MS) break;
    // Pick the section with the lowest pool that still needs filling,
    // restricted to the cron-allowed list.
    const target = cronSet
      .map((s) => ({ s, depth: status[s].pool }))
      .filter((x) => x.depth < poolTarget)
      .sort((a, b) => a.depth - b.depth)[0];
    if (!target) break;
    const sec = target.s;

    try {
      const generated = await generateSet(sec);
      const verdict = await judgeSet(generated);
      if (verdict.accept) {
        await sets.insertWithQuality(
          sec,
          generated,
          "cron",
          verdict.overall,
          verdict.notes,
        );
        status[sec].generated += 1;
        status[sec].pool += 1;
        status[sec].lastNote = `accepted (score ${verdict.overall})`;
      } else {
        status[sec].rejected += 1;
        status[sec].lastNote = `rejected (score ${verdict.overall}): ${verdict.notes}`;
      }
    } catch (e) {
      status[sec].errored += 1;
      status[sec].lastNote = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
    toGenerate -= 1;
  }

  // Bounded cleanup after generation so the pool table doesn't grow forever.
  const deleted = await sets.cleanupOld(
    config.cleanupMaxAgeHours,
    config.cleanupMaxRows,
  );

  return NextResponse.json({
    status: "done",
    cronSections: cronSet,
    poolTarget,
    purged,
    sections: status,
    cleanupDeleted: deleted,
    elapsedMs: Date.now() - start,
  });
}

/** Cron-job.org and GitHub Actions usually fire GET; some use POST. Accept both. */
export async function GET(req: Request) {
  if (!checkAuth(req))
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  return topupOnce(req);
}

export async function POST(req: Request) {
  if (!checkAuth(req))
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  return topupOnce(req);
}

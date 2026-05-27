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

  const needed = SECTIONS.filter((s) => status[s].pool < config.poolTarget);
  if (needed.length === 0) {
    // Nothing to do for generation. Still run cleanup.
    const deleted = await sets.cleanupOld(
      config.cleanupMaxAgeHours,
      config.cleanupMaxRows,
    );
    return NextResponse.json({
      status: "pool already full",
      pool: Object.fromEntries(SECTIONS.map((s) => [s, status[s].pool])),
      cleanupDeleted: deleted,
      elapsedMs: Date.now() - start,
    });
  }

  // Round-robin starting from the most-depleted section; generate up to
  // maxPerTick sets total. Each set: generate, judge, insert-if-accepted.
  // Stop early if we're approaching Vercel's 300s ceiling.
  const BUDGET_MS = 250_000;
  let toGenerate = config.maxPerTick;
  while (toGenerate > 0) {
    if (Date.now() - start > BUDGET_MS) break;
    // Pick the section with the lowest pool that still needs filling.
    const target = SECTIONS.map((s) => ({ s, depth: status[s].pool }))
      .filter((x) => x.depth < config.poolTarget)
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

/**
 * In-process auto-generation loop, controlled from the admin panel (Start/
 * Stop) instead of a separate `npm run worker` process the admin can't see
 * or stop. Lives as module state in the Next.js server process - works for
 * a persistent process (next dev / next start on a VPS); on a serverless
 * host this state wouldn't survive between invocations, same caveat as the
 * in-memory rate limiter (src/lib/rateLimit.ts).
 *
 * Round-robins one section at a time - VA, then RC, then DI, then LR, then
 * QA, back to VA - skipping only a section already at poolTarget. This is
 * deliberately NOT "always generate whichever section is neediest": that
 * approach starved DI and LR completely, because VA kept failing/rejecting
 * and never filled up, so a priority-by-neediness loop got stuck retrying
 * VA forever and never even attempted the other sections. A fixed
 * round-robin guarantees every section gets a turn regardless of how often
 * any other section fails. Firing several sections concurrently was also
 * tried and made rate-limit timeouts worse (all of them competing for the
 * same small pool of API keys at once) - one at a time is both fairer and
 * more reliable. Use the "Generate all needed now" button for a genuine
 * parallel burst instead.
 */
import { SECTIONS, QA_TOPICS, config, type Section, type QaTopic } from "@/lib/config";
import { sets } from "@/lib/db";
import { generateOneForPool } from "./pool";

let running = false;
let ticking = false;
let lastTickAt: number | null = null;

export function isAutoRunning(): boolean {
  return running;
}

export function autoLoopStatus() {
  return { running, ticking, lastTickAt };
}

export function startAutoLoop(): void {
  if (running) return;
  running = true;
  void loop();
}

export function stopAutoLoop(): void {
  running = false;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let cursor = 0;

/** Everything the loop keeps warm: full mixed pools per section, plus one
 * small drill pool per QA topic. Round-robined as a single flat list so a
 * struggling pool can never starve the others (the same reason sections
 * round-robin instead of going neediest-first). */
interface WarmTarget {
  section: Section;
  topic: QaTopic | null;
  target: number;
  label: string;
}

function warmTargets(): WarmTarget[] {
  const list: WarmTarget[] = SECTIONS.map((section) => ({
    section,
    topic: null,
    target: config.poolTarget,
    label: section,
  }));
  for (const topic of QA_TOPICS) {
    list.push({ section: "QA", topic, target: config.topicPoolTarget, label: `QA:${topic}` });
  }
  return list;
}

async function loop(): Promise<void> {
  while (running) {
    // Walk the fixed cycle starting from wherever we left off, generating
    // for the first target that's still below its depth. Advancing the
    // cursor every call (not just on a hit) is what makes this a true
    // round-robin instead of "always start checking from VA".
    const targets = warmTargets();
    let firedThisPass = false;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[cursor % targets.length];
      cursor += 1;
      if (!running) return;
      const pool = await sets.qualityPoolCount(t.section, t.topic);
      if (pool >= t.target) continue;
      ticking = true;
      lastTickAt = Date.now();
      await generateOneForPool(t.section, "worker", { topic: t.topic ?? undefined }).catch(() => null);
      ticking = false;
      firedThisPass = true;
      break;
    }
    if (!firedThisPass) {
      await sleep(30_000);
    }
  }
}

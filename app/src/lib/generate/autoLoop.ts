/**
 * In-process auto-generation loop, controlled from the admin panel (Start/
 * Stop) instead of a separate `npm run worker` process the admin can't see
 * or stop. Lives as module state in the Next.js server process - works for
 * a persistent process (next dev / next start on a VPS); on a serverless
 * host this state wouldn't survive between invocations, same caveat as the
 * in-memory rate limiter (src/lib/rateLimit.ts).
 *
 * Each tick: find every section below poolTarget, fire one
 * generateOneForPool for EACH of them concurrently (that's the "generate
 * multiple together" part - one call per section in parallel, spread across
 * whatever Groq keys are configured), wait for the tick to finish, then
 * immediately check again. Idles with a short sleep when nothing's needed.
 */
import { SECTIONS, config, type Section } from "@/lib/config";
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

async function loop(): Promise<void> {
  while (running) {
    const needed: Section[] = [];
    for (const s of SECTIONS) {
      const pool = await sets.qualityPoolCount(s);
      if (pool < config.poolTarget) needed.push(s);
    }
    if (needed.length === 0) {
      await sleep(30_000);
      continue;
    }
    ticking = true;
    lastTickAt = Date.now();
    await Promise.all(needed.map((s) => generateOneForPool(s, "worker").catch(() => null)));
    ticking = false;
    // Loop straight back around - generateOneForPool already takes a while
    // per section, so there's no need for an extra delay between ticks.
  }
}

import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { SECTIONS, type Section } from "@/lib/config";
import { generateOneForPool } from "@/lib/generate/pool";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Admin-triggered "Generate now": runs the same judge-gated
 * generateOneForPool used by the worker/cron, on demand. Two shapes:
 *   { section, count }  - N sets for one section, run CONCURRENTLY
 *   { sections: [...] } - one set per listed section, also concurrently
 * Either way, capped at 5 concurrent generations per request so one click
 * can't run indefinitely or blow past what the configured API keys can
 * actually sustain at once. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as
    | { section?: unknown; count?: unknown; sections?: unknown }
    | null;

  let jobs: Section[];
  if (Array.isArray(body?.sections)) {
    jobs = body.sections.filter((s): s is Section => SECTIONS.includes(s));
    if (jobs.length === 0) {
      return NextResponse.json({ error: "No valid sections given." }, { status: 400 });
    }
  } else {
    const section = body?.section as Section | undefined;
    if (!section || !SECTIONS.includes(section)) {
      return NextResponse.json({ error: "Unknown section." }, { status: 400 });
    }
    const count = Math.min(5, Math.max(1, Number(body?.count) || 1));
    jobs = Array(count).fill(section);
  }
  jobs = jobs.slice(0, 5);

  const results = await Promise.all(jobs.map((s) => generateOneForPool(s, "admin")));
  return NextResponse.json({ results: results.map((r, i) => ({ section: jobs[i], ...r })) });
}

import { NextResponse } from "next/server";
import { config, SECTIONS, type Section } from "@/lib/config";
import { sets } from "@/lib/db";
import { generateSet } from "@/lib/generate";
import { judgeSet } from "@/lib/generate/judge";
import { recordGeneration } from "@/lib/metrics";

// On Groq, a set generates in 10-30s; Hobby max is 300s.
export const maxDuration = 300;

/**
 * Worker-only endpoint: generate ONE set for the given section and add it to
 * the pool. Authenticated with the shared WORKER_TOKEN. Runs the same judge
 * gate as cron-topup (this used to insert unjudged sets - the one path
 * feeding the pool with zero quality control).
 */
export async function POST(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (auth !== `Bearer ${config.workerToken}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const url = new URL(req.url);
  const section = url.searchParams.get("section") as Section | null;
  if (!section || !SECTIONS.includes(section)) {
    return NextResponse.json({ error: "Bad section." }, { status: 400 });
  }
  const t0 = Date.now();
  try {
    const generated = await generateSet(section);
    const verdict = await judgeSet(generated);
    const ms = Date.now() - t0;
    if (!verdict.accept) {
      await recordGeneration(section, "reject", { score: verdict.overall, notes: verdict.notes, ms, source: "worker" });
      return NextResponse.json({
        rejected: true,
        section,
        score: verdict.overall,
        notes: verdict.notes,
      });
    }
    const id = await sets.insertWithQuality(section, generated, "worker", verdict.overall, verdict.notes);
    await recordGeneration(section, "accept", { score: verdict.overall, ms, source: "worker" });
    return NextResponse.json({
      id,
      section,
      score: verdict.overall,
      warnings: generated.meta.warnings,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await recordGeneration(section, "error", { notes: message, ms: Date.now() - t0, source: "worker" });
    return NextResponse.json(
      { error: "Generation failed: " + message },
      { status: 502 },
    );
  }
}

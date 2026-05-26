/**
 * Cron-triggered pool topup, for hosted deployments where we can't run the
 * standalone worker loop (Vercel etc.).
 *
 * Vercel Cron Jobs fire this endpoint on a schedule defined in vercel.json.
 * The request carries an "Authorization: Bearer <CRON_SECRET>" header that
 * we verify against process.env.CRON_SECRET. Each invocation generates ONE
 * set for whichever section has the lowest pool right now.
 *
 * Local dev still uses scripts/worker.mjs which calls /api/internal/topup.
 */
import { NextResponse } from "next/server";
import { config, SECTIONS, type Section } from "@/lib/config";
import { sets } from "@/lib/db";
import { generateSet } from "@/lib/generate";

export const maxDuration = 300;

export async function GET(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const expected = process.env.CRON_SECRET || config.workerToken;
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // Pick the section that needs a set most.
  const counts = await Promise.all(
    SECTIONS.map(async (s) => ({ s, c: await sets.poolCount(s) })),
  );
  counts.sort((a, b) => a.c - b.c);
  const target = counts[0];
  if (target.c >= config.poolSize) {
    return NextResponse.json({ status: "pool full", counts });
  }

  try {
    const generated = await generateSet(target.s as Section);
    const id = await sets.insert(target.s, generated, "cron");
    return NextResponse.json({
      status: "topped up",
      section: target.s,
      id,
      warnings: generated.meta.warnings,
    });
  } catch (e) {
    return NextResponse.json(
      {
        status: "failed",
        section: target.s,
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }
}

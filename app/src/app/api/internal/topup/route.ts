import { NextResponse } from "next/server";
import { config, SECTIONS, type Section } from "@/lib/config";
import { sets } from "@/lib/db";
import { generateSet } from "@/lib/generate";

// On Groq, a set generates in 10-30s; Hobby max is 300s.
export const maxDuration = 300;

/**
 * Worker-only endpoint: generate ONE set for the given section and add it to
 * the pool. Authenticated with the shared WORKER_TOKEN.
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
  try {
    const generated = await generateSet(section);
    const id = await sets.insert(section, generated, "worker");
    return NextResponse.json({
      id,
      section,
      warnings: generated.meta.warnings,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          "Generation failed: " + (e instanceof Error ? e.message : String(e)),
      },
      { status: 502 },
    );
  }
}

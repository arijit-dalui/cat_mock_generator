import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { sets, attempts, events } from "@/lib/db";
import { SECTIONS, type Section } from "@/lib/config";
import { generateSet } from "@/lib/generate";

// Generation can take a while on a local CPU model. Groq is much faster.
export const maxDuration = 300;

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: { section?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const section = body.section as Section;
  if (!SECTIONS.includes(section)) {
    return NextResponse.json({ error: "Unknown section." }, { status: 400 });
  }

  // Prefer a ready-made set from the pool; otherwise generate on demand.
  let setRow = await sets.takeFromPool(section);
  if (!setRow) {
    try {
      const generated = await generateSet(section);
      const id = await sets.insert(section, generated, `user:${user.id}`);
      await sets.markServed(id);
      setRow = await sets.byId(id);
    } catch (e) {
      return NextResponse.json(
        {
          error:
            "Could not generate a set. Is the LLM available? " +
            (e instanceof Error ? e.message : ""),
        },
        { status: 502 },
      );
    }
  }
  if (!setRow) {
    return NextResponse.json({ error: "Generation failed." }, { status: 502 });
  }

  const attemptId = await attempts.create(user.id, setRow.id, section);
  await events.log("generate", user.id, section);
  return NextResponse.json({ attemptId });
}

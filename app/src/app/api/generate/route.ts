import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { db, sets, attempts, events } from "@/lib/db";
import { SECTIONS, type Section } from "@/lib/config";
import { generateSet } from "@/lib/generate";

// Generation can take a while on a local CPU model.
export const maxDuration = 300;

export async function POST(req: Request) {
  const user = currentUser();
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
  let setRow = sets.takeFromPool(section);
  if (!setRow) {
    try {
      const generated = await generateSet(section);
      const id = sets.insert(section, generated, `user:${user.id}`);
      db.prepare("UPDATE generated_sets SET status = 'served' WHERE id = ?").run(id);
      setRow = sets.byId(id);
    } catch (e) {
      return NextResponse.json(
        {
          error:
            "Could not generate a set. Is the LLM (Ollama) running? " +
            (e instanceof Error ? e.message : ""),
        },
        { status: 502 },
      );
    }
  }
  if (!setRow) {
    return NextResponse.json({ error: "Generation failed." }, { status: 502 });
  }

  const attemptId = attempts.create(user.id, setRow.id, section);
  events.log("generate", user.id, section);
  return NextResponse.json({ attemptId });
}

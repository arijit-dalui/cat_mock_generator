import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { mocks, attempts, sets } from "@/lib/db";
import type { GeneratedSet } from "@/lib/generate/types";

function parseSet(payload: unknown): GeneratedSet {
  let parsed: unknown = payload;
  for (let i = 0; i < 3 && typeof parsed === "string"; i++) {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      break;
    }
  }
  return parsed as GeneratedSet;
}

/** A mock plus its five section attempts, each with its set payload
 * attached - everything MockClient needs to run all three phases without
 * further round-trips per section. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const mock = await mocks.byId(Number(params.id));
  if (!mock || mock.user_id !== user.id) {
    return NextResponse.json({ error: "Mock not found." }, { status: 404 });
  }
  const rows = await attempts.byMock(mock.id);
  const withSets = await Promise.all(
    rows.map(async (a) => {
      const setRow = await sets.byId(a.set_id);
      return {
        attemptId: a.id,
        section: a.section,
        phase: a.phase,
        submitted: !!a.submitted,
        score: a.score,
        total: a.total,
        rawScore: a.raw_score,
        answers: a.answers ? (typeof a.answers === "string" ? JSON.parse(a.answers) : a.answers) : {},
        createdAt: a.created_at,
        set: setRow ? parseSet(setRow.payload) : null,
      };
    }),
  );

  return NextResponse.json({
    mock: { id: mock.id, submitted: !!mock.submitted, createdAt: mock.created_at, submittedAt: mock.submitted_at },
    attempts: withSets,
  });
}

/** Marks the mock itself submitted once every phase's attempts are done.
 * Individual attempts are still submitted through the normal
 * /api/attempts/[id]/submit route - this just closes out the wrapper. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const mock = await mocks.byId(Number(params.id));
  if (!mock || mock.user_id !== user.id) {
    return NextResponse.json({ error: "Mock not found." }, { status: 404 });
  }
  const rows = await attempts.byMock(mock.id);
  if (rows.length === 0 || !rows.every((a) => a.submitted)) {
    return NextResponse.json({ error: "Not every section of this mock has been submitted yet." }, { status: 409 });
  }
  await mocks.submit(mock.id);
  return NextResponse.json({ ok: true });
}

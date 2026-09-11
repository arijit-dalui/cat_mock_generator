import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { attempts, sets } from "@/lib/db";
import type { GeneratedSet, GenQuestion } from "@/lib/generate/types";
import { allQuestions } from "@/lib/practice";

export const dynamic = "force-dynamic";

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

interface MistakeRow {
  attemptId: number;
  section: string;
  createdAt: string;
  question: GenQuestion;
  yourAnswer: string;
}

/** Every question the signed-in user got wrong across their own submitted
 * attempts - real data, recomputed the same way scoring/review does, most
 * recent first. Unanswered questions aren't included; a "mistake" here
 * means an actual wrong pick, not a skip. */
export async function GET() {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const rows = await attempts.listForUser(user.id);
  const submitted = rows.filter((r) => r.submitted);

  const mistakes: MistakeRow[] = [];
  for (const row of submitted) {
    const setRow = await sets.byId(row.set_id);
    if (!setRow) continue;
    const set = parseSet(setRow.payload);
    const answers = (typeof row.answers === "string" ? JSON.parse(row.answers) : row.answers) || {};

    for (const q of allQuestions(set)) {
      const picked = answers[q.id];
      if (picked === undefined || picked === null || String(picked).trim() === "") continue;
      const isTita = q.format === "tita";
      const isCorrect = isTita
        ? String(picked).trim() === String(q.answer).trim()
        : Number(picked) === Number(q.answer);
      if (isCorrect) continue;
      mistakes.push({
        attemptId: row.id,
        section: row.section,
        createdAt: row.created_at,
        question: q,
        yourAnswer: String(picked),
      });
    }
  }

  mistakes.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return NextResponse.json({ mistakes: mistakes.slice(0, 100) });
}

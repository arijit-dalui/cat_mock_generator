import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { attempts, sets, mocks } from "@/lib/db";
import type { GeneratedSet } from "@/lib/generate/types";
import { allQuestions } from "@/lib/practice";

export const dynamic = "force-dynamic";

interface MockHistoryRow {
  id: number;
  createdAt: string;
  phases: Record<string, number>; // phase -> summed raw_score
  total: number;
  percentile: number | null;
  population: number;
}

interface AttemptSummary {
  id: number;
  section: string;
  createdAt: string;
  correct: number;
  incorrect: number;
  unanswered: number;
  total: number;
  rawScore: number;
}

interface TopicRow {
  topic: string;
  attempts: number;
  correct: number;
  wrong: number;
}

/** Deep-parse a set payload: normally one JSON object, but a few legacy/
 * heal-rewritten rows are double-encoded (a JSON string scalar). */
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

/** Real history and per-topic accuracy computed from the user's own
 * submitted attempts - no modeled or fabricated numbers. Empty until they
 * have actually submitted something. */
export async function GET() {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const rows = await attempts.listForUser(user.id);
  const submitted = rows.filter((r) => r.submitted);

  const history: AttemptSummary[] = [];
  const topicsBySection: Record<string, Map<string, TopicRow>> = {};

  for (const row of submitted) {
    const setRow = await sets.byId(row.set_id);
    if (!setRow) continue;
    const set = parseSet(setRow.payload);
    const answers = (typeof row.answers === "string" ? JSON.parse(row.answers) : row.answers) || {};
    const qs = allQuestions(set);

    let correct = 0;
    let incorrect = 0;
    let unanswered = 0;
    let rawScore = 0;
    const topics = (topicsBySection[row.section] ??= new Map());

    for (const q of qs) {
      const picked = answers[q.id];
      const isTita = q.format === "tita";
      if (picked === undefined || picked === null || String(picked).trim() === "") {
        unanswered += 1;
        continue;
      }
      const isCorrect = isTita
        ? String(picked).trim() === String(q.answer).trim()
        : Number(picked) === Number(q.answer);
      const topicRow = topics.get(q.type) ?? { topic: q.type, attempts: 0, correct: 0, wrong: 0 };
      topicRow.attempts += 1;
      if (isCorrect) {
        correct += 1;
        rawScore += 3;
        topicRow.correct += 1;
      } else {
        incorrect += 1;
        if (!isTita) rawScore -= 1;
        topicRow.wrong += 1;
      }
      topics.set(q.type, topicRow);
    }

    history.push({
      id: row.id,
      section: row.section,
      createdAt: row.created_at,
      correct,
      incorrect,
      unanswered,
      total: qs.length,
      rawScore,
    });
  }

  history.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const topics: Record<string, TopicRow[]> = {};
  for (const [section, map] of Object.entries(topicsBySection)) {
    topics[section] = Array.from(map.values()).sort((a, b) => b.attempts - a.attempts);
  }

  // Comparative: this user's most recent attempt per section, ranked against
  // every submitted attempt in that section across ALL users. Real
  // population data only - null (not 0%) until there's more than one
  // attempt to compare against, so a lone user isn't shown a fake 100th
  // percentile.
  const latestBySection = new Map<string, AttemptSummary>();
  for (const h of history) latestBySection.set(h.section, h); // sorted ascending, so last write wins
  const percentile: Record<string, { percentile: number; population: number; rawScore: number } | null> = {};
  for (const [section, latest] of latestBySection) {
    const result = await attempts.percentile(section, latest.rawScore);
    percentile[section] = result ? { ...result, rawScore: latest.rawScore } : null;
  }

  // Overall percentile: the average of this user's per-section percentiles,
  // over whichever sections actually have one. Not a separate population
  // query (there's no single cross-section "raw score" to rank) - just an
  // honest summary of the per-section numbers already computed above.
  const validPercentiles = Object.values(percentile).filter((p): p is { percentile: number; population: number; rawScore: number } => p !== null);
  const overallPercentile =
    validPercentiles.length > 0
      ? validPercentiles.reduce((sum, p) => sum + p.percentile, 0) / validPercentiles.length
      : null;

  // Full-mock history: this user's submitted mocks, phase-wise raw score
  // totals (VARC/DILR/QA) plus an overall total, each ranked against every
  // other submitted mock's total across all users.
  const mockRows = await mocks.listForUser(user.id);
  const mockHistory: MockHistoryRow[] = [];
  for (const m of mockRows) {
    if (!m.submitted) continue;
    const mAttempts = await attempts.byMock(m.id);
    const phases: Record<string, number> = {};
    let total = 0;
    for (const a of mAttempts) {
      const phase = a.phase || a.section;
      phases[phase] = (phases[phase] ?? 0) + (a.raw_score ?? 0);
      total += a.raw_score ?? 0;
    }
    const pct = await mocks.percentile(total);
    mockHistory.push({
      id: m.id,
      createdAt: m.created_at,
      phases,
      total,
      percentile: pct?.percentile ?? null,
      population: pct?.population ?? 0,
    });
  }
  mockHistory.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return NextResponse.json({ history, topics, percentile, overallPercentile, mockHistory });
}

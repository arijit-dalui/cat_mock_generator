/** Helpers for working with a generated set during practice and scoring. */
import type { GeneratedSet, GenQuestion } from "./generate/types";

/** All questions of a set, flattened in display order. */
export function allQuestions(set: GeneratedSet): GenQuestion[] {
  if (set.kind === "questions") return set.items ?? [];
  return (set.sets ?? []).flatMap((s) => s.questions);
}

export interface ScoreResult {
  correct: number;
  incorrect: number;
  unanswered: number;
  total: number;
  /** CAT convention: +3 correct, −1 wrong MCQ, 0 wrong/unanswered TITA. */
  rawScore: number;
}

function normaliseTitaAnswer(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/^\+/, "")
    .replace(/,/g, "")
    .replace(/\s+/g, "")
    .replace(/^(-?)0+(\d)/, "$1$2");
}

/** Score a set according to CAT marking. Legacy questions are MCQ by default.
 * Values are deliberately normalised so persisted JSON answers remain stable
 * across SQLite and Postgres round-trips. */
export function scoreSet(
  set: GeneratedSet,
  answers: Record<string, unknown>,
): ScoreResult {
  const qs = allQuestions(set);
  let correct = 0;
  let incorrect = 0;
  let unanswered = 0;
  let rawScore = 0;
  for (const q of qs) {
    const picked = answers[q.id];
    const isTita = q.format === "tita";
    if (picked === undefined || picked === null || String(picked).trim() === "") {
      unanswered += 1;
      continue;
    }
    const isCorrect = isTita
      ? normaliseTitaAnswer(picked) === normaliseTitaAnswer(q.answer)
      : Number(picked) === Number(q.answer);
    if (isCorrect) {
      correct += 1;
      rawScore += 3;
    } else {
      incorrect += 1;
      if (!isTita) rawScore -= 1;
    }
  }
  return { correct, incorrect, unanswered, rawScore, total: qs.length };
}

/** Friendly section names for the UI. */
export const SECTION_NAMES: Record<string, string> = {
  VA: "Verbal Ability",
  RC: "Reading Comprehension",
  DI: "Data Interpretation",
  LR: "Logical Reasoning",
  QA: "Quantitative Ability",
};

/** Helpers for working with a generated set during practice and scoring. */
import type { GeneratedSet, GenQuestion } from "./generate/types";

/** All questions of a set, flattened in display order. */
export function allQuestions(set: GeneratedSet): GenQuestion[] {
  if (set.kind === "questions") return set.items ?? [];
  return (set.sets ?? []).flatMap((s) => s.questions);
}

/** Score a set against a map of questionId -> chosen option index.
 * Defensively coerces both sides to numbers so a JSONB round-trip that
 * stringifies values (e.g. answers = {"q1": "2"}) still scores correctly. */
export function scoreSet(
  set: GeneratedSet,
  answers: Record<string, unknown>,
): { correct: number; total: number } {
  const qs = allQuestions(set);
  let correct = 0;
  for (const q of qs) {
    const picked = Number(answers[q.id]);
    const key = Number(q.answer);
    if (Number.isFinite(picked) && Number.isFinite(key) && picked === key) correct += 1;
  }
  return { correct, total: qs.length };
}

/** Friendly section names for the UI. */
export const SECTION_NAMES: Record<string, string> = {
  VA: "Verbal Ability",
  RC: "Reading Comprehension",
  DI: "Data Interpretation",
  LR: "Logical Reasoning",
  QA: "Quantitative Ability",
};

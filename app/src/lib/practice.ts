/** Helpers for working with a generated set during practice and scoring. */
import type { GeneratedSet, GenQuestion } from "./generate/types";

/** All questions of a set, flattened in display order. */
export function allQuestions(set: GeneratedSet): GenQuestion[] {
  if (set.kind === "questions") return set.items ?? [];
  return (set.sets ?? []).flatMap((s) => s.questions);
}

/** Score a set against a map of questionId -> chosen option index. */
export function scoreSet(
  set: GeneratedSet,
  answers: Record<string, number>,
): { correct: number; total: number } {
  const qs = allQuestions(set);
  let correct = 0;
  for (const q of qs) if (answers[q.id] === q.answer) correct += 1;
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

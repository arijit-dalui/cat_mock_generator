/** Shared shapes for generated problem sets. */
import type { Section } from "../config";

export type QuestionFormat = "mcq" | "tita";

/** A single question. TITA questions intentionally have no options and accept
 * a typed answer; existing generated MCQs remain valid without `format`. */
export interface GenQuestion {
  id: string;
  type: string; // subtype, e.g. para_jumble, geometry, rc
  format?: QuestionFormat;
  prompt: string; // the question stem
  options: string[]; // exactly 4 for MCQ; empty for TITA
  answer: number | string; // option index for MCQ; canonical typed answer for TITA
  explanations: string[]; // parallel to options for MCQ
  solution: string; // overall worked solution
}

/** A set sharing one context (an RC passage, a DI dataset, an LR scenario). */
export interface GenSubSet {
  id: string;
  contextLabel: string; // "Reading Comprehension", "Data Interpretation", ...
  context: string; // the passage / data / scenario
  source: string; // "Aeon: <title>" or "mock-derived"
  questions: GenQuestion[];
}

/** A full generated set, as stored in generated_sets.payload (JSON). */
export interface GeneratedSet {
  section: Section;
  kind: "questions" | "sets";
  items?: GenQuestion[]; // for VA and QA
  sets?: GenSubSet[]; // for RC, DI and LR
  meta: {
    generatedAt: string;
    model: string;
    warnings: string[];
  };
}

/** Total number of questions in a generated set. */
export function setQuestionCount(set: GeneratedSet): number {
  if (set.kind === "questions") return set.items?.length ?? 0;
  return (set.sets ?? []).reduce((n, s) => n + s.questions.length, 0);
}

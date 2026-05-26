/**
 * Prompt builders for the generation engine. Each builder returns a string
 * that asks the LLM for strict JSON in the shape the validator expects.
 */
import type { KbItem } from "../kb";

/** JSON contract for a batch of standalone questions (VA, QA). */
const SCHEMA_QUESTIONS = `Return JSON of this exact shape:
{"questions":[
  {
    "prompt": "the full question text",
    "options": ["option 1", "option 2", "option 3", "option 4"],
    "answer": 0,
    "explanations": ["why option 1 is right/wrong", "...2", "...3", "...4"],
    "solution": "the full worked reasoning leading to the answer"
  }
]}
Rules: exactly 4 options; "answer" is the 0-based index of the single correct
option; "explanations" has exactly 4 entries, one per option, each saying
clearly why that option is correct or incorrect.`;

/** JSON contract for a passage/data set with 4 questions (RC, DI, LR). */
const SCHEMA_SET = `Return JSON of this exact shape:
{
  "context": "the passage / dataset / scenario the questions are based on",
  "questions": [
    {
      "prompt": "question text",
      "options": ["o1","o2","o3","o4"],
      "answer": 0,
      "explanations": ["...1","...2","...3","...4"],
      "solution": "worked reasoning"
    }
  ]
}
Rules: exactly 4 questions; each question has exactly 4 options; "answer" is the
0-based index of the correct option; "explanations" has 4 entries.`;

/** Clean up the artefacts that PDF extraction leaves in KB exemplars:
 * single-character-per-line wrap, ALL-CAPS DIRECTIONS preambles, repeated
 * whitespace, "Q.27" / "Q27." numbering, page footers, etc. */
export function cleanExemplar(stem: string): string {
  let s = stem;
  // Re-flow lines where every "line" is only 1-2 characters wide.
  const lines = s.split(/\r?\n/);
  const reflowed: string[] = [];
  let buf = "";
  for (const ln of lines) {
    const t = ln.trim();
    if (t.length === 0) {
      if (buf) {
        reflowed.push(buf);
        buf = "";
      }
      reflowed.push("");
      continue;
    }
    if (t.length <= 2) {
      buf += t;
    } else {
      if (buf) {
        reflowed.push(buf);
        buf = "";
      }
      reflowed.push(t);
    }
  }
  if (buf) reflowed.push(buf);
  s = reflowed.join("\n");
  // Strip CAT-paper preamble blocks.
  s = s.replace(
    /DIRECTIONS?\s+for\s+(the\s+)?questions?[^.\n]*?(?:[\.:]\s*)/gi,
    "",
  );
  s = s.replace(/Q\.?\s*\d+[\.:]?\s*/g, "");
  s = s.replace(/Question\s+\d+[\.:]?\s*/gi, "");
  // Collapse repeated whitespace.
  s = s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return s;
}

function formatExemplars(items: KbItem[], max = 3): string {
  const picked = items.slice(0, max);
  if (!picked.length) return "";
  const blocks = picked.map(
    (it, i) => `Example ${i + 1}:\n${cleanExemplar(it.stem).slice(0, 700)}`,
  );
  return (
    `\nStyle references from past CAT papers - match this STYLE and ` +
    `difficulty, but DO NOT copy or lightly reword them; invent fresh ` +
    `content. Do NOT copy any "DIRECTIONS" preamble or question numbering ` +
    `from these examples:\n\n${blocks.join("\n\n")}\n`
  );
}

const VA_BRIEF: Record<string, string> = {
  para_jumble:
    "para-jumble questions: give 4-5 sentences labelled and ask for the correct logical order. Options are orderings.",
  para_completion:
    "para-completion questions: a short paragraph with the last/blank sentence missing; options are candidate sentences.",
  odd_one_out:
    "odd-one-out questions: 4-5 sentences of which one does not fit the others; options identify the misfit.",
  summary:
    "summary questions: a short paragraph followed by 4 candidate summaries; pick the best.",
  va_other:
    "CAT verbal-ability questions (critical reasoning, inference, vocabulary-in-context).",
};

export function vaPrompt(subtype: string, count: number, exemplars: KbItem[]): string {
  const brief = VA_BRIEF[subtype] ?? VA_BRIEF.va_other;
  const formatRules =
    subtype === "para_jumble"
      ? `\nFormat each "prompt" exactly like:\n` +
        `"Arrange the following sentences in the correct logical order.\\n` +
        `1. <sentence>\\n2. <sentence>\\n3. <sentence>\\n4. <sentence>\\n5. <sentence>"\n` +
        `Each option must be a 5-character ordering string drawn from "12345" ` +
        `(every digit 1-5 used exactly once), e.g. "31245".`
      : subtype === "para_completion"
      ? `\nIn the "prompt", show the paragraph with the final sentence ` +
        `replaced by "_____". Each option is a candidate sentence (full sentence, not a fragment).`
      : subtype === "odd_one_out"
      ? `\nFormat the "prompt" as a numbered list of 5 sentences (1-5). ` +
        `Each option must be a single digit string "1"-"5" naming the misfit.`
      : subtype === "summary"
      ? `\nFormat the "prompt" as the paragraph followed by "\\nWhich of the ` +
        `following best summarises the passage?". Each option is a one- or ` +
        `two-sentence summary.`
      : "";
  return (
    `You are a CAT (Common Admission Test) verbal expert. Create ${count} ` +
    `original, exam-quality ${brief}\n` +
    `Each must be genuinely solvable with one clearly best answer. ` +
    `Write in clean prose. Do NOT include any "DIRECTIONS for questions..." ` +
    `preamble or question numbers like "Q.27" - the app handles numbering. ` +
    `Do NOT use smart/curly quotes; use straight ASCII quotes only.` +
    formatRules +
    formatExemplars(exemplars) +
    `\n${SCHEMA_QUESTIONS}`
  );
}

export function qaPrompt(topic: string, count: number, exemplars: KbItem[]): string {
  return (
    `You are a CAT quantitative-ability expert. Create ${count} original, ` +
    `exam-quality multiple-choice questions on the topic: ${topic}.\n` +
    `CRITICAL: solve every question yourself step by step and double-check the ` +
    `arithmetic. The "answer" index MUST point to the mathematically correct ` +
    `option, and "solution" must show the working that proves it. Distractor ` +
    `options should be plausible (typical mistakes), not random. Each option ` +
    `must be a CONCRETE numeric or algebraic value (e.g. "24", "3/5", ` +
    `"x = 2"), never a placeholder like "o1". Use straight ASCII quotes only.` +
    formatExemplars(exemplars) +
    `\n${SCHEMA_QUESTIONS}`
  );
}

export function rcPrompt(passage: string, sourceLabel: string, exemplars: KbItem[]): string {
  return (
    `You are a CAT verbal expert. Below is a reading passage (${sourceLabel}). ` +
    `Create exactly 4 CAT-style reading-comprehension questions on it ` +
    `(main idea, inference, tone/purpose, and detail). Questions must be ` +
    `answerable purely from the passage. Write all text in clean ASCII; ` +
    `use straight quotes only; inside JSON strings escape newlines as \\n.\n\n` +
    `PASSAGE:\n${passage}\n` +
    formatExemplars(exemplars, 1) +
    `\nReturn JSON: {"questions":[{prompt,options,answer,explanations,solution} x4]} ` +
    `with exactly 4 options and a 4-entry explanations array per question.`
  );
}

export function diPrompt(exemplars: KbItem[]): string {
  return (
    `You are a CAT data-interpretation expert. Invent an original DI set: a ` +
    `compact dataset plus exactly 4 questions based on it.\n` +
    `Put the full dataset in "context" as a GitHub-Flavoured Markdown table ` +
    `with concrete numeric cells. Example shape:\n\n` +
    `| Month | Alpha | Beta |\n|---|---|---|\n| Jan | 50 | 48 |\n| Feb | 70 | 65 |\n\n` +
    `Then briefly explain what the table represents BELOW the table.\n` +
    `Each question option must be a CONCRETE value (a number, percentage, ` +
    `month name, or short phrase) - never a placeholder like "o1" or "o2".\n` +
    `Solve each question yourself; the "answer" index must be numerically ` +
    `correct and "solution" must show the calculation step by step. Use ` +
    `straight ASCII quotes only; escape newlines as \\n inside JSON strings.` +
    formatExemplars(exemplars, 2) +
    `\n${SCHEMA_SET}`
  );
}

export function lrPrompt(exemplars: KbItem[]): string {
  return (
    `You are a CAT logical-reasoning expert. Invent an original LR set: a ` +
    `self-contained scenario with a clear set of conditions (arrangement, ` +
    `distribution, ordering or grouping) plus exactly 4 questions.\n` +
    `In "context": first state the scenario in 1-3 sentences, then list the ` +
    `conditions as a numbered list (1., 2., 3., ...). The conditions MUST ` +
    `yield a consistent, uniquely determinable situation. Solve the scenario ` +
    `yourself first to verify uniqueness.\n` +
    `Each question option must be a CONCRETE answer (a name, position, ` +
    `number, or short phrase) - never a placeholder like "o1".\n` +
    `Solve each question yourself and show the deduction in "solution". Use ` +
    `straight ASCII quotes only; escape newlines as \\n inside JSON strings.` +
    formatExemplars(exemplars, 2) +
    `\n${SCHEMA_SET}`
  );
}

/** Independent re-solve, used to verify a generated QA/DI question. */
export function verifyPrompt(prompt: string, options: string[]): string {
  return (
    `Solve this CAT question carefully and independently. Show your working.\n\n` +
    `QUESTION:\n${prompt}\n\nOPTIONS:\n` +
    options.map((o, i) => `${i}: ${o}`).join("\n") +
    `\n\nReturn JSON: {"answer": <0-based index of the correct option>, ` +
    `"working": "your step-by-step solution"}`
  );
}

/**
 * Prompt builders for the generation engine. Each builder returns a string
 * that asks the LLM for strict JSON in the shape the validator expects.
 *
 * Difficulty target: top-percentile CAT (LRDI / VARC / QA) — the kind of
 * question that a strong test-taker still has to think about for 2-3 minutes.
 * The prompts spell out anti-easy rubrics, distractor design rules, and a
 * mandatory explanation structure so the LLM can't fall back to baby
 * mechanics.
 */
import type { KbItem } from "../kb";

/** Compact rules injected into every prompt. Kept short to stay under Groq
 * free-tier TPM cap (12K/min). */
const EXPLANATION_RUBRIC =
  `EXPLANATIONS — one per option, EXACTLY 4, in A,B,C,D order, each 2-3 ` +
  `sentences beginning "Correct." or "Incorrect.". DEPTH comes from SPECIFICITY, ` +
  `not length: for the correct option give the decisive reason and the concrete ` +
  `number/step that proves it; for every wrong option name the SPECIFIC mistake ` +
  `that produces it AND the wrong value it leads to ` +
  `(e.g. "Incorrect. Uses gross 240 not net 216, giving 20% instead of 8%."). ` +
  `NEVER use vague filler ("this is wrong", "does not fit", "first identify...") ` +
  `without the concrete reason — vague or incomplete explanations are rejected. ` +
  `SOLUTION: 4-8 numbered lines, the actual numbers at each step, ending with the ` +
  `answer letter. No self-correction, no "actually"/"wait"/"let's redo"; if the ` +
  `working contradicts the answer index, REDO the question silently. ` +
  `Keep wording tight so the COMPLETE set fits the response: shorten prose if ` +
  `needed but NEVER drop a question or leave any option/explanation/solution empty.`;

const DIFFICULTY_RUBRIC =
  `DIFFICULTY: CAT 99-percentile. Each Q needs 3+ inference/computation ` +
  `steps; no plug-and-chug. Decisive insight should be a hidden constraint, ` +
  `case split, quantifier flip, or unit trap. Distractors must each be the ` +
  `answer to a specific named mistake (one = "the answer to a slightly ` +
  `different question"); avoid silly distractors.`;

/** JSON contract for a batch of standalone questions (VA, QA). */
const SCHEMA_QUESTIONS = `Return JSON of this exact shape:
{"questions":[
  {
    "prompt": "the full question text",
    "options": ["option A text", "option B text", "option C text", "option D text"],
    "answer": "A",
    "explanations": ["why A is right/wrong", "why B...", "why C...", "why D..."],
    "solution": "the full worked reasoning leading to the answer"
  }
]}
Rules: exactly 4 options in A,B,C,D order; "answer" MUST be the LETTER ("A",
"B", "C", or "D") of the single correct option; "explanations" has exactly 4
entries, one per option in A,B,C,D order. The letter in "answer" must match
the option that the "solution" working actually arrives at. SIZE: output EVERY
question requested, each one complete (full options, 4 explanations, solution) —
returning fewer or leaving fields empty gets the whole set discarded.`;

/** JSON contract for a passage/data set with 4 questions (RC, DI, LR). */
const SCHEMA_SET = `Return JSON of this exact shape:
{
  "context": "the passage / dataset / scenario the questions are based on",
  "questions": [
    {
      "prompt": "question text",
      "options": ["A text","B text","C text","D text"],
      "answer": "A",
      "explanations": ["why A...","why B...","why C...","why D..."],
      "solution": "worked reasoning"
    }
  ]
}
Rules: exactly 4 questions; each question has exactly 4 options in A,B,C,D
order; "answer" MUST be the LETTER ("A","B","C","D") of the correct option
and must match what the "solution" actually arrives at; "explanations" has 4
entries, one per option in A,B,C,D order. SIZE: the set MUST contain all 4
questions, each complete (full options, 4 explanations, solution). A set with
fewer than 4 questions, or any empty field, is discarded — so keep the passage/
dataset and prose concise enough that all 4 complete questions fit the response.`;

/** Clean up the artefacts that PDF extraction leaves in KB exemplars:
 * single-character-per-line wrap, ALL-CAPS DIRECTIONS preambles, repeated
 * whitespace, "Q.27" / "Q27." numbering, page footers, etc. */
export function cleanExemplar(stem: string): string {
  let s = stem;
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
  s = s.replace(
    /DIRECTIONS?\s+for\s+(the\s+)?questions?[^.\n]*?(?:[\.:]\s*)/gi,
    "",
  );
  s = s.replace(/Q\.?\s*\d+[\.:]?\s*/g, "");
  s = s.replace(/Question\s+\d+[\.:]?\s*/gi, "");
  s = s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return s;
}

function formatExemplars(items: KbItem[], max = 1): string {
  const picked = items.slice(0, max);
  if (!picked.length) return "";
  const blocks = picked.map(
    (it, i) => `Example ${i + 1}:\n${cleanExemplar(it.stem).slice(0, 400)}`,
  );
  return (
    `\nStyle reference (DO NOT copy or reword — invent fresh content):\n\n` +
    `${blocks.join("\n\n")}\n`
  );
}

const VA_BRIEF: Record<string, string> = {
  para_jumble:
    "para-jumble: 5 sentences (labelled 1-5 in scrambled order) that must be reordered into one coherent paragraph. EXACTLY ONE sentence must be a self-contained OPENER — a topic/thesis statement that introduces the subject with NO back-reference and NO transition-word start — and it must be the intended first sentence. Do NOT write sentences that nearly all begin with a connective: at most one or two sentences may start with 'however / moreover / therefore / by contrast / furthermore'; every other sentence must begin with its own subject (a noun phrase), not a discourse marker. CRUCIAL: the correct order must be driven by the LOGICAL / CONCEPTUAL progression of the argument (a claim, then its elaboration, an example, a qualification, a conclusion) — NOT by obvious surface cues. Do NOT lean on explicit conjunctions or pronouns ('this', 'such a view', 'the latter', 'however', 'therefore') as glue that makes the sequence trivially obvious; a solver should have to follow the MEANING and the flow of ideas, not just chain pronouns and connectives. Avoid chronology and digit labels as ordering signals.",
  para_completion:
    "para-completion: a 4-6 sentence paragraph with the FINAL sentence blanked out (_____). The right completion must follow logically from the SPECIFIC argument the paragraph develops — not from generic topical relevance. Two distractors should be topically related but logically off (broaden the scope, contradict the implied premise, or echo a counter-argument).",
  odd_one_out:
    "odd-one-out: 5 sentences on a single theme, one of which does not fit. The odd one usually breaks the THEMATIC LINE (advocacy vs description, cause vs effect, historical vs contemporary). Surface keyword overlap with the rest is a red herring — the misfit should share vocabulary but diverge in argumentative role.",
  summary:
    "summary: a 120-200 word paragraph followed by 4 candidate summaries. The right summary must preserve the AUTHOR'S CENTRAL CLAIM AND ITS SCOPE. Distractors should: (a) over-generalise, (b) capture only a sub-claim, (c) flip a qualifier, (d) confuse the author's view with the view the author critiques.",
  va_other:
    "CAT verbal-ability (critical reasoning, inference, vocabulary-in-context).",
};

export function vaPrompt(subtype: string, count: number, exemplars: KbItem[]): string {
  const brief = VA_BRIEF[subtype] ?? VA_BRIEF.va_other;
  const formatRules =
    subtype === "para_jumble"
      ? `\nFormat each "prompt" exactly like:\n` +
        `"Arrange the following sentences in the correct logical order.\\n` +
        `1. <sentence>\\n2. <sentence>\\n3. <sentence>\\n4. <sentence>\\n5. <sentence>"\n` +
        `There are 5 SENTENCES but exactly 4 OPTIONS (A-D) — do not confuse the ` +
        `two counts. Each option must be a 5-character ordering string drawn ` +
        `from "12345" (every digit 1-5 used exactly once), e.g. "31245". ` +
        `"options" must be an array of exactly 4 such strings, no more, no ` +
        `fewer, and no two options may be identical. The resolution must ` +
        `depend on the LOGICAL flow of the argument (claim -> elaboration -> ` +
        `example/qualification -> conclusion), NOT on calendar dates, numeric ` +
        `labels, or obvious word-glue. Do NOT make the order trivially obvious ` +
        `by chaining explicit connectives or pronouns ("this", "such a view", ` +
        `"the latter", "however", "therefore"); the solver should have to ` +
        `reason about MEANING, not just spot a pronoun pointing back at the ` +
        `previous sentence.\n` +
        `STYLE: do NOT have most sentences open with "However"/"Moreover"/` +
        `"Therefore"/"Furthermore" — that pattern destroys the puzzle. Keep the ` +
        `independent OPENER sentence (subject-first, no back-reference) so a ` +
        `unique start exists.\n` +
        `CRITICAL — verify the key: actually SOLVE the jumble yourself and make ` +
        `the "answer" letter point to the option whose ordering string ` +
        `reconstructs the coherent paragraph. The sentence placed first in the ` +
        `correct order MUST be the standalone opener; a sentence beginning with ` +
        `a back-reference or connective ("However", "Moreover", "Therefore", ` +
        `"This", "Such") can NEVER be first. Before output, COUNT your ` +
        `"options" array — it must have length 4, not 5. Confirm every ` +
        `option is a permutation of 1-5 and that exactly one option is correct.`
      : subtype === "para_completion"
      ? `\nIn the "prompt", show the paragraph with the final sentence ` +
        `replaced by "_____". The blank should fall in a place where the ` +
        `paragraph has built an EXPECTATION (a contrast, a corollary, a ` +
        `qualification) — and the right option must satisfy that expectation. ` +
        `Each option is a candidate sentence (full sentence, not a fragment).`
      : subtype === "odd_one_out"
      ? `\nFormat each "prompt" exactly like:\n` +
        `"The five sentences below relate to the same theme. ` +
        `Identify the ONE sentence that does not fit logically with the ` +
        `others.\\n1. <sentence>\\n2. <sentence>\\n3. <sentence>\\n` +
        `4. <sentence>\\n5. <sentence>"\n` +
        `Each option must be a single digit string "1"-"5" naming the misfit. ` +
        `The misfit should break the thematic line (advocacy vs description, ` +
        `cause vs effect, etc.), not the surface vocabulary.`
      : subtype === "summary"
      ? `\nFormat each "prompt" exactly as: the paragraph, then a NEWLINE, ` +
        `then the literal question "Which of the following best summarises ` +
        `the paragraph above?". Each option is a one- or two-sentence summary.`
      : "";
  return (
    `You are a CAT (Common Admission Test) verbal-ability paper-setter, ` +
    `writing for the 99-percentile aspirant. Create ${count} ` +
    `original, exam-quality ${brief}\n\n` +
    DIFFICULTY_RUBRIC +
    `\n\nWrite in clean prose. Vocabulary should be advanced (graduate-level) ` +
    `where natural; subject matter should be philosophy, history of ideas, ` +
    `economics, environmental policy, art criticism — NOT generic ` +
    `"company sells gadgets" filler. Do NOT include "DIRECTIONS for ` +
    `questions..." preambles or "Q.27" numbering. Use straight ASCII quotes ` +
    `only.` +
    formatRules +
    `\n\n` + EXPLANATION_RUBRIC +
    formatExemplars(exemplars) +
    `\n${SCHEMA_QUESTIONS}`
  );
}

const QA_DEPTH: Record<string, string> = {
  geometry:
    "Mix coordinate geometry with circle/triangle properties, or layer two non-trivial theorems (power-of-a-point, angle bisector, Stewart's, Apollonius, Ptolemy, inscribed-angle). Avoid plug-and-chug Pythagoras unless wrapped in a non-obvious construction.",
  algebra:
    "Use Vieta's, polynomial-remainder reasoning, functional equations, AM-GM/Cauchy bounds, or non-trivial system-of-equations with a parametric twist. Avoid 'solve 2x+5=11' baby algebra.",
  arithmetic:
    "Use multi-stage percentage chains, mixture/alligation with non-uniform proportions, ratio-and-proportion with a hidden invariant, time-speed-distance with relative motion + breaks, or partnership with profit-share twists. Numbers should resist mental arithmetic without insight.",
  number_system:
    "Use modular arithmetic, base conversion + property check, digit-sum / digit-product constraints, properties of factorials/HCF/LCM, last-digit / last-two-digit problems, or counting integers in a range with multiple divisibility constraints.",
  modern_math:
    "Use combinatorics with restriction (derangements, inclusion-exclusion, with-repetition vs without), probability with conditional / Bayes-style reasoning, sequences with a non-obvious closed form, or set-theory Venn questions where the unknown overlap is the key.",
};

export function qaPrompt(topic: string, count: number, exemplars: KbItem[]): string {
  const depth = QA_DEPTH[topic] ?? "";
  return (
    `You are a CAT quantitative-ability paper-setter, writing for the ` +
    `99-percentile aspirant. Create ${count} original, exam-quality ` +
    `multiple-choice questions on the topic: ${topic}.\n\n` +
    DIFFICULTY_RUBRIC +
    `\n\nTopic-specific depth requirement:\n${depth}\n\n` +
    `CRITICAL: solve every question yourself step by step and double-check ` +
    `the arithmetic. The "answer" index MUST point to the mathematically ` +
    `correct option, and "solution" must show the working that proves it. ` +
    `Each option must be a CONCRETE numeric or algebraic value (e.g. "24", ` +
    `"3/5", "x = 2"), never a placeholder like "o1". Numbers in the question ` +
    `should NOT be round (avoid 100, 1000) unless the question is about ` +
    `roundness itself. Use straight ASCII quotes only.\n\n` +
    EXPLANATION_RUBRIC +
    formatExemplars(exemplars) +
    `\n${SCHEMA_QUESTIONS}`
  );
}

export function rcPrompt(passage: string, sourceLabel: string, exemplars: KbItem[]): string {
  return (
    `You are a CAT verbal paper-setter, writing for the 99-percentile ` +
    `aspirant. Below is a reading passage (${sourceLabel}). Create exactly 4 ` +
    `CAT-style RC questions on it, drawn from this mix:\n` +
    `- exactly ONE main-idea / central-argument question\n` +
    `- exactly ONE inference question (something IMPLIED but not stated)\n` +
    `- exactly ONE tone / author's-stance / purpose-of-paragraph question\n` +
    `- exactly ONE specific-detail question that hinges on a qualifier ` +
    `("most", "only", "primarily") most readers miss.\n\n` +
    DIFFICULTY_RUBRIC +
    `\n\nRC-specific rules:\n` +
    `- Wrong options must each be UN-rejectable on a casual reading; you have ` +
    `to return to the passage to eliminate them.\n` +
    `- Use one "trap" distractor that paraphrases a sentence from the ` +
    `passage too literally (echoes the wording but mis-captures the role of ` +
    `that sentence in the argument).\n` +
    `- Use one "out-of-scope" distractor that extends the author's view ` +
    `beyond what the passage actually supports.\n` +
    `- Questions must be answerable purely from the passage.\n\n` +
    `RC EXPLANATIONS — RC has no numbers, so "concrete" means POINTING TO THE ` +
    `TEXT: every explanation must anchor on the specific sentence/phrase it ` +
    `relies on (quote 2-5 words from the passage) AND name the SPECIFIC reading ` +
    `mistake each wrong option makes — e.g. "confuses the author's own view with ` +
    `the counter-view in para 2", "treats the qualifier 'most' as 'all'", ` +
    `"extends the para-3 claim beyond what the text supports", "restates a ` +
    `detail that is true but not what the question asks". Name a DIFFERENT ` +
    `specific misconception for each distractor; generic reasons ("this is not ` +
    `correct", "does not match") are rejected.\n\n` +
    EXPLANATION_RUBRIC +
    `\n\nPASSAGE:\n${passage}\n` +
    formatExemplars(exemplars, 1) +
    `\nReturn JSON: {"questions":[{prompt,options,answer,explanations,solution} x4]} ` +
    `with exactly 4 options and a 4-entry explanations array per question. ` +
    `Use straight ASCII quotes; escape newlines as \\n inside JSON strings.`
  );
}

export function diPrompt(exemplars: KbItem[]): string {
  return (
    `You are a CAT data-interpretation paper-setter, writing for the ` +
    `99-percentile aspirant. Invent an original DI set: a compact dataset ` +
    `plus exactly 4 questions based on it.\n\n` +
    DIFFICULTY_RUBRIC +
    `\n\nDI-specific rules:\n` +
    `- The dataset must contain a HIDDEN constraint that has to be discovered ` +
    `before the questions can be answered (e.g. one row's value is given ` +
    `only via a relationship to others; a column total must be inferred; a ` +
    `cell is "*" or "X" meaning "deducible from the rest"). State this ` +
    `constraint in the prose below the table.\n` +
    `- Questions must require COMBINING at least 2 cells with at least 1 ` +
    `derived quantity (percentage change, ratio, growth rate, weighted ` +
    `average). One-cell-lookup questions ("What is February sales of Beta?") ` +
    `are BANNED.\n` +
    `- Use multi-period or multi-segment data (4-6 rows × 3-4 columns) so ` +
    `the test-taker has to track which subset applies.\n` +
    `- At least one question should be a "smart-shortcut" question where ` +
    `the elegant path is much faster than brute computation.\n\n` +
    `Put the full dataset in "context" as a GitHub-Flavoured Markdown table ` +
    `with concrete numeric cells. Example shape:\n\n` +
    `| Year | Region A | Region B | Region C |\n|---|---|---|---|\n` +
    `| 2018 | 124 | 87 | 156 |\n| 2019 | 138 | 93 | * |\n\n` +
    `Then in the prose below: state the hidden relationship (e.g. ` +
    `"Region C in 2019 grew by 12.5% over 2018"). Each question option must ` +
    `be a CONCRETE value (number, percentage, name, short phrase) — never ` +
    `a placeholder like "o1".\n\n` +
    `Solve each question yourself; the "answer" index must be numerically ` +
    `correct.\n\n` + EXPLANATION_RUBRIC +
    `\n\nUse straight ASCII quotes only; escape newlines as \\n inside JSON strings.` +
    formatExemplars(exemplars, 2) +
    `\n${SCHEMA_SET}`
  );
}

export function lrPrompt(exemplars: KbItem[]): string {
  return (
    `You are a CAT logical-reasoning paper-setter, writing for the ` +
    `99-percentile aspirant. Invent an original LR set: a self-contained ` +
    `scenario with a clear set of conditions (arrangement, distribution, ` +
    `ordering, grouping, matching) plus exactly 4 questions.\n\n` +
    DIFFICULTY_RUBRIC +
    `\n\nLR-specific rules:\n` +
    `- The set must be a "partial-info" puzzle: the conditions narrow the ` +
    `solution space to a SMALL number of valid configurations (1-4), but ` +
    `NOT necessarily a unique one. Then the questions distinguish between ` +
    `"definitely true", "possibly true", "definitely false". CAT-style LR ` +
    `often has 2-3 valid base configurations.\n` +
    `- Use 6-8 entities and 5-7 conditions. Conditions should include at ` +
    `least one CONDITIONAL ("if X then Y"), at least one EITHER-OR, and at ` +
    `least one NEGATIVE constraint ("Z is not adjacent to W").\n` +
    `- At least one question must be a "minimum/maximum" question (e.g. ` +
    `"what is the maximum number of X that can be Y?") that requires case ` +
    `analysis.\n` +
    `- Avoid trivial puzzles like "5 people in a row, A is left of B, who ` +
    `sits at position 3?".\n\n` +
    `In "context": first state the scenario in 1-3 sentences, then list the ` +
    `conditions as a numbered list (1., 2., 3., ...). Then briefly outline ` +
    `the solution space (e.g. "there are 3 valid arrangements; in all of ` +
    `them, X sits at position 1"). Solve the scenario yourself first; if no ` +
    `valid configuration exists, REWRITE the conditions.\n\n` +
    `Each question option must be a CONCRETE answer (name, position, number, ` +
    `short phrase) — never a placeholder.\n\n` + EXPLANATION_RUBRIC +
    `\n\nUse straight ASCII quotes only; escape newlines as \\n inside JSON strings.` +
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

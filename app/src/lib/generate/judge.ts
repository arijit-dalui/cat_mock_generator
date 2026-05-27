/**
 * Independent quality judge. Scores a freshly generated CAT set on four
 * dimensions and returns a verdict. Uses a DIFFERENT model from the writer
 * (see config.llm.judgeModel) so the judgment isn't just the writer
 * marking its own homework.
 *
 * The judge is intentionally strict — sets that score < MIN_QUALITY on any
 * dimension are rejected and not inserted into the pool.
 */
import { config } from "../config";
import { chatJSON } from "../llm";
import type { GeneratedSet } from "./types";

export interface JudgeScores {
  difficulty: number;
  answer_correctness: number;
  distractor_quality: number;
  explanation_depth: number;
}

export interface JudgeVerdict {
  scores: JudgeScores;
  notes: string;
  accept: boolean;
  /** Overall score = min across dimensions (worst-case). */
  overall: number;
}

/** Strip the full set down to just the parts the judge needs to score it.
 * Kept tight (~3.5K chars) to fit comfortably in Groq's smaller judge-model
 * context window. */
function summariseForJudge(set: GeneratedSet): string {
  const lines: string[] = [`Section: ${set.section}`];
  if (set.kind === "questions" && set.items) {
    lines.push(`Items (${set.items.length}):`);
    for (const [i, q] of set.items.entries()) {
      lines.push(`\nQ${i + 1} [${q.type}]: ${String(q.prompt).slice(0, 280)}`);
      q.options.forEach((o, k) =>
        lines.push(`  ${"ABCD"[k]}. ${String(o).slice(0, 120)}`),
      );
      lines.push(`  ANSWER: ${"ABCD"[q.answer]}`);
      lines.push(`  SOLUTION: ${String(q.solution).slice(0, 240)}`);
      lines.push(
        `  EXPL: ` +
          q.explanations.map((e, k) => `${"ABCD"[k]}:${String(e).slice(0, 80)}`).join(" | "),
      );
    }
  } else if (set.kind === "sets" && set.sets) {
    for (const [si, s] of set.sets.entries()) {
      lines.push(`\nSet ${si + 1} context:`);
      lines.push(String(s.context).slice(0, 500));
      for (const [i, q] of s.questions.entries()) {
        lines.push(`\n  Q${i + 1}: ${String(q.prompt).slice(0, 220)}`);
        q.options.forEach((o, k) =>
          lines.push(`    ${"ABCD"[k]}. ${String(o).slice(0, 100)}`),
        );
        lines.push(`    ANSWER: ${"ABCD"[q.answer]}`);
        lines.push(`    SOLUTION: ${String(q.solution).slice(0, 200)}`);
      }
    }
  }
  return lines.join("\n").slice(0, 3500);
}

const JUDGE_PROMPT = `You are a strict CAT (Common Admission Test) examiner reviewing an AI-generated practice set for the 99-percentile aspirant. Score the set 0-10 on EACH dimension:

1. difficulty:
   10 = genuinely hard (requires 2-3 minutes of real work, multi-step inference)
   6  = solid CAT level
   3  = textbook plug-and-chug
   0  = baby-school question

2. answer_correctness:
   10 = every "answer" index agrees with the solution working
   6  = at most one minor inconsistency
   0  = solution contradicts answer key in multiple places

3. distractor_quality:
   10 = every wrong option corresponds to a SPECIFIC named mistake
   6  = at least 2/3 of wrong options are real-misconception traps
   3  = distractors are random / obviously wrong
   0  = placeholder distractors

4. explanation_depth:
   10 = explanations name the specific misconception per option AND solution has concrete numbers/steps
   6  = explanations attempt this but some are vague
   3  = skeleton explanations ("first identify... then consider...")
   0  = empty / placeholder

Be strict. A 7 means "I'd put this in a real CAT mock". A 4 means "weak but salvageable". Below 4 means "throw out".

Output JSON exactly:
{
  "scores": {"difficulty": N, "answer_correctness": N, "distractor_quality": N, "explanation_depth": N},
  "notes": "one-line summary of the biggest weakness",
  "accept": true_if_min_score_>=_${config.minQuality}_else_false
}`;

/** Judge a generated set. Returns a verdict; never throws (errors -> accept). */
export async function judgeSet(set: GeneratedSet): Promise<JudgeVerdict> {
  // Empty / failed sets fail the judge automatically.
  const itemCount =
    set.kind === "questions"
      ? set.items?.length ?? 0
      : set.sets?.reduce((n, s) => n + s.questions.length, 0) ?? 0;
  if (itemCount === 0) {
    return {
      scores: {
        difficulty: 0,
        answer_correctness: 0,
        distractor_quality: 0,
        explanation_depth: 0,
      },
      notes: "Set is empty (writer produced no items).",
      accept: false,
      overall: 0,
    };
  }

  try {
    const data = await chatJSON<{
      scores?: JudgeScores;
      notes?: string;
      accept?: boolean;
    }>(JUDGE_PROMPT + "\n\nSET TO JUDGE:\n" + summariseForJudge(set), {
      temperature: 0.1,
      model: config.llm.judgeModel,
      // qwen3-32b on Groq has a smaller max_tokens than llama-3.3-70b.
      // The judge only needs ~200 tokens to output its small JSON.
      maxTokens: 1024,
    });
    const s = data?.scores;
    if (!s) {
      return {
        scores: { difficulty: 0, answer_correctness: 0, distractor_quality: 0, explanation_depth: 0 },
        notes: "Judge returned no scores.",
        accept: false,
        overall: 0,
      };
    }
    const dims = [
      Number(s.difficulty) || 0,
      Number(s.answer_correctness) || 0,
      Number(s.distractor_quality) || 0,
      Number(s.explanation_depth) || 0,
    ];
    const overall = Math.min(...dims);
    return {
      scores: {
        difficulty: dims[0],
        answer_correctness: dims[1],
        distractor_quality: dims[2],
        explanation_depth: dims[3],
      },
      notes: String(data.notes ?? "").slice(0, 300),
      accept: overall >= config.minQuality,
      overall,
    };
  } catch (e) {
    // Judge unavailable: fail closed (don't insert junk).
    return {
      scores: { difficulty: 0, answer_correctness: 0, distractor_quality: 0, explanation_depth: 0 },
      notes: `Judge call failed: ${e instanceof Error ? e.message : String(e)}`,
      accept: false,
      overall: 0,
    };
  }
}

/** CAT marking (scoreSet) is money-adjacent - it decides every percentile,
 * leaderboard rank and public profile number in the app. Wrong marking here
 * silently corrupts every downstream stat, so it gets real tests. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreSet, allQuestions } from "../src/lib/practice.ts";
import type { GeneratedSet, GenQuestion } from "../src/lib/generate/types.ts";

function mcq(id: string, answer: number): GenQuestion {
  return {
    id,
    type: "algebra",
    format: "mcq",
    prompt: "stem",
    options: ["a", "b", "c", "d"],
    answer,
    explanations: ["", "", "", ""],
    solution: "",
  };
}

function tita(id: string, answer: string): GenQuestion {
  return {
    id,
    type: "arithmetic",
    format: "tita",
    prompt: "stem",
    options: [],
    answer,
    explanations: [],
    solution: "",
  };
}

function questionsSet(items: GenQuestion[]): GeneratedSet {
  return { section: "QA", kind: "questions", items, meta: { generatedAt: "", model: "", warnings: [] } };
}

test("scoreSet: +3 for a correct MCQ", () => {
  const set = questionsSet([mcq("q1", 2)]);
  const r = scoreSet(set, { q1: 2 });
  assert.deepEqual(r, { correct: 1, incorrect: 0, unanswered: 0, total: 1, rawScore: 3 });
});

test("scoreSet: -1 for a wrong MCQ", () => {
  const set = questionsSet([mcq("q1", 2)]);
  const r = scoreSet(set, { q1: 0 });
  assert.deepEqual(r, { correct: 0, incorrect: 1, unanswered: 0, total: 1, rawScore: -1 });
});

test("scoreSet: 0 for an unanswered question (not counted as wrong)", () => {
  const set = questionsSet([mcq("q1", 2)]);
  const r = scoreSet(set, {});
  assert.deepEqual(r, { correct: 0, incorrect: 0, unanswered: 1, total: 1, rawScore: 0 });
});

test("scoreSet: TITA scores 0 (not -1) when wrong, +3 when right", () => {
  const set = questionsSet([tita("q1", "42")]);
  const wrong = scoreSet(set, { q1: "17" });
  assert.equal(wrong.incorrect, 1);
  assert.equal(wrong.rawScore, 0); // no negative marking for TITA

  const right = scoreSet(set, { q1: "42" });
  assert.equal(right.correct, 1);
  assert.equal(right.rawScore, 3);
});

test("scoreSet: TITA answers are normalised (whitespace, commas, leading zeros/plus)", () => {
  const set = questionsSet([tita("q1", "1,050")]);
  for (const submitted of ["1050", " 1050 ", "+1050", "01050", "1,050"]) {
    const r = scoreSet(set, { q1: submitted });
    assert.equal(r.correct, 1, `expected "${submitted}" to normalise to a match`);
  }
});

test("scoreSet: a blank string counts as unanswered, not wrong", () => {
  const set = questionsSet([mcq("q1", 1)]);
  const r = scoreSet(set, { q1: "" });
  assert.equal(r.unanswered, 1);
  assert.equal(r.incorrect, 0);
});

test("scoreSet: mixed set totals correctly across correct/wrong/unanswered", () => {
  const set = questionsSet([mcq("q1", 0), mcq("q2", 0), mcq("q3", 0), tita("q4", "5")]);
  const r = scoreSet(set, { q1: 0, q2: 1, q4: "9" }); // q3 unanswered
  assert.deepEqual(r, { correct: 1, incorrect: 2, unanswered: 1, total: 4, rawScore: 3 - 1 - 0 });
});

test("allQuestions: flattens a 'sets' kind (RC/DI/LR) across sub-sets", () => {
  const set: GeneratedSet = {
    section: "RC",
    kind: "sets",
    sets: [
      { id: "s1", contextLabel: "RC", context: "", source: "", questions: [mcq("a", 0), mcq("b", 1)] },
      { id: "s2", contextLabel: "RC", context: "", source: "", questions: [mcq("c", 2)] },
    ],
    meta: { generatedAt: "", model: "", warnings: [] },
  };
  assert.deepEqual(allQuestions(set).map((q) => q.id), ["a", "b", "c"]);
});

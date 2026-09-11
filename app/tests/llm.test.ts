/** extractJSON is what turns a raw LLM response into a question set - every
 * generated set passes through it. LLMs reliably wrap JSON in markdown
 * fences, add trailing commentary, or emit literal newlines inside string
 * values, so those are exactly the cases worth pinning down. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractJSON } from "../src/lib/jsonExtract.ts";

test("extractJSON: plain JSON object", () => {
  assert.deepEqual(extractJSON('{"a": 1, "b": "x"}'), { a: 1, b: "x" });
});

test("extractJSON: strips a markdown code fence", () => {
  const text = '```json\n{"a": 1}\n```';
  assert.deepEqual(extractJSON(text), { a: 1 });
});

test("extractJSON: ignores commentary before and after the object", () => {
  const text = 'Sure, here is the JSON:\n{"a": 1}\nHope that helps!';
  assert.deepEqual(extractJSON(text), { a: 1 });
});

test("extractJSON: picks the JSON array when that's the top-level shape", () => {
  assert.deepEqual(extractJSON("[1, 2, 3]"), [1, 2, 3]);
});

test("extractJSON: nested braces inside strings don't break bracket matching", () => {
  const text = '{"prompt": "solve for {x}", "answer": 2}';
  assert.deepEqual(extractJSON(text), { prompt: "solve for {x}", answer: 2 });
});

test("extractJSON: recovers from a literal (unescaped) newline inside a string", () => {
  // LLMs frequently emit a real newline instead of \n inside a JSON string,
  // which fails JSON.parse outright - sanitiseJsonControlChars should fix it.
  const text = '{"solution": "line one\nline two"}';
  const parsed = extractJSON(text) as { solution: string };
  assert.equal(parsed.solution, "line one\nline two");
});

test("extractJSON: throws when there's no JSON at all", () => {
  assert.throws(() => extractJSON("no json here"));
});

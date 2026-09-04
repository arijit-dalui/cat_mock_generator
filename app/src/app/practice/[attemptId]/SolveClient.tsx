"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { sectionDeadline } from "@/lib/exam";

interface GenQuestion {
  id: string;
  type: string;
  format?: "mcq" | "tita";
  prompt: string;
  options: string[];
  answer: number | string;
  explanations: string[];
  solution: string;
}
interface GenSubSet {
  id: string;
  contextLabel: string;
  context: string;
  source: string;
  questions: GenQuestion[];
}
interface GeneratedSet {
  section: string;
  kind: "questions" | "sets";
  items?: GenQuestion[];
  sets?: GenSubSet[];
}
interface AttemptData {
  attempt: {
    id: number;
    section: string;
    submitted: boolean;
    score: number | null;
    total: number | null;
    answers: Record<string, unknown>;
    createdAt: string;
  };
  set: GeneratedSet;
}

/** One navigable slot in the single-question solving view. RC/DI/LR
 * questions carry the passage/context they belong to; VA/QA carry none. */
interface NavItem {
  q: GenQuestion;
  contextLabel?: string;
  context?: string;
  source?: string;
}

const OPT = ["A", "B", "C", "D"];

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Minimal markdown renderer for DI/LR contexts: GFM tables, bold, italic, ` */
function renderContext(src: string): string {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  const inlineFmt = (t: string) =>
    escapeHtml(t)
      .replace(/`([^`]+)`/g, '<code class="rounded bg-slate-100 px-1">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");

  while (i < lines.length) {
    const ln = lines[i];
    // Markdown table: header row + separator row + body rows
    if (
      ln.trim().startsWith("|") &&
      i + 1 < lines.length &&
      /^\s*\|?\s*:?-+/.test(lines[i + 1])
    ) {
      const splitRow = (r: string) =>
        r
          .replace(/^\s*\|/, "")
          .replace(/\|\s*$/, "")
          .split("|")
          .map((c) => c.trim());
      const headers = splitRow(ln);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      out.push(
        `<div class="overflow-x-auto"><table class="my-2 w-full border-collapse text-sm">` +
          `<thead><tr>` +
          headers
            .map(
              (h) =>
                `<th class="border border-slate-300 bg-slate-50 px-3 py-1.5 text-left font-semibold">${inlineFmt(
                  h,
                )}</th>`,
            )
            .join("") +
          `</tr></thead><tbody>` +
          rows
            .map(
              (r) =>
                `<tr>` +
                r
                  .map(
                    (c) =>
                      `<td class="border border-slate-300 px-3 py-1.5">${inlineFmt(
                        c,
                      )}</td>`,
                  )
                  .join("") +
                `</tr>`,
            )
            .join("") +
          `</tbody></table></div>`,
      );
      continue;
    }
    if (ln.trim() === "") {
      out.push("");
      i++;
      continue;
    }
    out.push(`<p class="my-1">${inlineFmt(ln)}</p>`);
    i++;
  }
  return out.join("\n");
}

/** Some LLM generations forget to include the directional sentence
 * (e.g. odd-one-out prompts that show 5 numbered sentences but no
 * "identify the misfit" instruction). Prepend a fallback when we
 * detect that pattern. */
function withInstructionFallback(q: GenQuestion): string {
  const p = q.prompt;
  if (
    q.type === "para_jumble" &&
    /^\s*1\.\s/.test(p) &&
    !/arrange|order|sequence/i.test(p.slice(0, 80))
  ) {
    return "Arrange the following sentences in the correct logical order.\n" + p;
  }
  if (
    q.type === "odd_one_out" &&
    /\b1\.\s/.test(p) &&
    !/misfit|odd one|does not fit|not belong/i.test(p)
  ) {
    return (
      "Five sentences below relate to the same theme. Identify the ONE sentence that does not fit with the others.\n" +
      p
    );
  }
  if (
    q.type === "para_completion" &&
    !/_____|complete the|best completes|fill in the blank/i.test(p)
  ) {
    return "Choose the option that best completes the paragraph below.\n" + p;
  }
  if (q.type === "summary" && !/summari[sz]e|main idea|best capture/i.test(p)) {
    return p + "\nWhich of the following best summarises the paragraph above?";
  }
  return p;
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const s = (total % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export default function SolveClient({ attemptId }: { attemptId: string }) {
  const [data, setData] = useState<AttemptData | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [visited, setVisited] = useState<Set<string>>(new Set());
  const [current, setCurrent] = useState(0);
  const [reviewed, setReviewed] = useState(false);
  const [score, setScore] = useState<{ correct: number; total: number; rawScore?: number } | null>(
    null,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const autoSubmitted = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/attempts/${attemptId}`);
        const d = await res.json();
        if (!res.ok) {
          setError(d.error || "Could not load this set.");
          return;
        }
        setData(d);
        if (d.attempt.submitted) {
          setAnswers(d.attempt.answers || {});
          setReviewed(true);
          setScore({ correct: d.attempt.score, total: d.attempt.total });
        }
      } catch {
        setError("Network error.");
      }
    })();
  }, [attemptId]);

  const nav: NavItem[] = useMemo(() => {
    if (!data) return [];
    if (data.set.kind === "questions") {
      return (data.set.items ?? []).map((q) => ({ q }));
    }
    return (data.set.sets ?? []).flatMap((ss) =>
      ss.questions.map((q) => ({
        q,
        contextLabel: ss.contextLabel,
        context: ss.context,
        source: ss.source,
      })),
    );
  }, [data]);

  // Mark the current question visited whenever it changes.
  useEffect(() => {
    if (reviewed || nav.length === 0) return;
    const id = nav[current]?.q.id;
    if (!id) return;
    setVisited((v) => (v.has(id) ? v : new Set(v).add(id)));
  }, [current, nav, reviewed]);

  const submit = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/attempts/${attemptId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error || "Could not submit.");
        return;
      }
      setScore({ correct: d.score, total: d.total, rawScore: d.rawScore });
      setReviewed(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }, [attemptId, answers]);

  // Sectional countdown. Deadline is derived from when the attempt was
  // created server-side, so a page refresh can't reset the clock.
  useEffect(() => {
    if (!data || reviewed) return;
    const deadline = sectionDeadline(data.attempt.createdAt);
    const tick = () => {
      const left = deadline - Date.now();
      setRemainingMs(left);
      if (left <= 0 && !autoSubmitted.current) {
        autoSubmitted.current = true;
        submit();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [data, reviewed, submit]);

  const pick = useCallback(
    (qid: string, idx: number) => {
      if (reviewed) return;
      setAnswers((a) => ({ ...a, [qid]: idx }));
    },
    [reviewed],
  );

  const typeAnswer = useCallback(
    (qid: string, value: string) => {
      if (reviewed) return;
      setAnswers((a) => ({ ...a, [qid]: value }));
    },
    [reviewed],
  );

  const toggleMark = useCallback((qid: string) => {
    setMarked((m) => {
      const next = new Set(m);
      if (next.has(qid)) next.delete(qid);
      else next.add(qid);
      return next;
    });
  }, []);

  const clearResponse = useCallback((qid: string) => {
    setAnswers((a) => {
      const next = { ...a };
      delete next[qid];
      return next;
    });
  }, []);

  if (error)
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-red-600">{error}</p>
        <Link href="/dashboard" className="btn-ghost mt-4">
          Back to dashboard
        </Link>
      </main>
    );
  if (!data)
    return <main className="mx-auto max-w-3xl px-6 py-10 text-slate-400">Loading...</main>;

  const questions = data.set.kind === "questions" ? data.set.items ?? [] : [];
  const subsets = data.set.kind === "sets" ? data.set.sets ?? [] : [];
  const isEmpty =
    (data.set.kind === "questions" && questions.length === 0) ||
    (data.set.kind === "sets" && subsets.length === 0);

  let n = 0;
  function renderReviewQuestion(q: GenQuestion) {
    n += 1;
    const isTita = q.format === "tita";
    const chosen = answers[q.id] === undefined ? undefined : Number(answers[q.id]);
    const typedAnswer = String(answers[q.id] ?? "");
    const correctIdx = Number(q.answer);
    const prompt = withInstructionFallback(q);
    return (
      <div key={q.id} className="card p-5">
        <p className="font-medium text-slate-900">
          <span className="text-slate-400">Q{n}.</span>{" "}
          <span className="whitespace-pre-wrap">{prompt}</span>
        </p>
        {isTita ? (
          <div className="mt-4 max-w-xs">
            <p className="text-sm text-slate-600">
              Your answer: <span className="font-mono font-semibold text-slate-900">{typedAnswer || "—"}</span>
            </p>
            <p className="mt-1 text-sm text-slate-600">
              Correct answer: <span className="font-semibold text-slate-900">{String(q.answer)}</span>
            </p>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {q.options.map((opt, i) => {
              const isChosen = chosen === i;
              const isCorrect = correctIdx === i;
              let cls = "border-slate-300";
              if (isCorrect) cls = "border-green-500 bg-green-50";
              else if (isChosen && !isCorrect) cls = "border-red-500 bg-red-50";
              return (
                <div key={i}>
                  <div className={"w-full rounded-lg border px-3 py-2 text-left text-sm " + cls}>
                    <span className="font-semibold text-slate-500">{OPT[i]}.</span> {opt}
                  </div>
                  <p className="mt-1 px-3 text-xs text-slate-500">{q.explanations[i]}</p>
                </div>
              );
            })}
          </div>
        )}
        {q.solution && (
          <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
            <span className="font-semibold text-slate-700">Solution: </span>
            <span className="whitespace-pre-wrap">{q.solution}</span>
          </div>
        )}
      </div>
    );
  }

  // ---- Post-submit review: full list, no timer, no palette -------------
  if (reviewed) {
    return (
      <div className="min-h-screen">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
            <Link href="/dashboard" className="text-sm font-medium text-brand">
              &larr; Dashboard
            </Link>
            <span className="text-sm text-slate-500">
              {data.set.section} - Set #{data.attempt.id}
            </span>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-6 py-8">
          {score && (
            <div className="mb-6 rounded-xl bg-brand p-5 text-white shadow-sm">
              <p className="text-lg font-semibold">
                Your score: {score.rawScore ?? score.correct} marks
              </p>
              <p className="text-sm text-white/80">
                {score.correct} correct out of {score.total}. Review the explanations for every option below.
              </p>
            </div>
          )}
          {isEmpty && (
            <div className="card p-5">
              <p className="font-medium text-slate-900">This set could not be generated.</p>
              <p className="mt-2 text-sm text-slate-600">
                The model was unable to produce a valid {data.set.section} set this time. Please go
                back to the dashboard and click <span className="font-semibold">Generate a new set</span> again -
                a fresh attempt usually succeeds.
              </p>
            </div>
          )}
          {data.set.kind === "questions" && questions.length > 0 && (
            <div className="space-y-4">{questions.map(renderReviewQuestion)}</div>
          )}
          {data.set.kind === "sets" &&
            subsets.map((ss) => (
              <div key={ss.id} className="mb-8">
                <div className="card mb-4 p-5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-brand">
                    {ss.contextLabel}
                  </p>
                  <div
                    className="prose-cat mt-2 text-sm leading-relaxed text-slate-700"
                    dangerouslySetInnerHTML={{ __html: renderContext(ss.context) }}
                  />
                  {ss.source && <p className="mt-2 text-xs text-slate-400">Source: {ss.source}</p>}
                </div>
                <div className="space-y-4">{ss.questions.map(renderReviewQuestion)}</div>
              </div>
            ))}
          <Link href="/dashboard" className="btn-ghost mt-6">
            Back to dashboard
          </Link>
        </main>
      </div>
    );
  }

  // ---- Live attempt: one question at a time + palette -------------------
  if (isEmpty) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="card p-5">
          <p className="font-medium text-slate-900">This set could not be generated.</p>
          <p className="mt-2 text-sm text-slate-600">
            The model was unable to produce a valid {data.set.section} set this time. Please go back
            to the dashboard and click <span className="font-semibold">Generate a new set</span> again -
            a fresh attempt usually succeeds.
          </p>
        </div>
        <Link href="/dashboard" className="btn-ghost mt-4">
          Back to dashboard
        </Link>
      </main>
    );
  }

  const item = nav[current];
  const total = nav.length;
  const answeredCount = nav.filter((it) => answers[it.q.id] !== undefined && String(answers[it.q.id]).trim() !== "").length;
  const unansweredCount = total - answeredCount;
  const lowTime = remainingMs !== null && remainingMs < 5 * 60_000;
  const isTita = item.q.format === "tita";
  const chosen = answers[item.q.id] === undefined ? undefined : Number(answers[item.q.id]);
  const typedAnswer = String(answers[item.q.id] ?? "");
  const isMarked = marked.has(item.q.id);
  const isAnswered = answers[item.q.id] !== undefined && String(answers[item.q.id]).trim() !== "";

  function statusOf(qid: string): "answered" | "marked" | "answered-marked" | "visited" | "unvisited" {
    const answered = answers[qid] !== undefined && String(answers[qid]).trim() !== "";
    const isMarkedQ = marked.has(qid);
    if (answered && isMarkedQ) return "answered-marked";
    if (isMarkedQ) return "marked";
    if (answered) return "answered";
    if (visited.has(qid)) return "visited";
    return "unvisited";
  }

  const statusStyle: Record<string, string> = {
    unvisited: "bg-slate-100 text-slate-500 border-slate-200",
    visited: "bg-red-50 text-red-700 border-red-300",
    answered: "bg-green-100 text-green-800 border-green-400",
    marked: "bg-purple-100 text-purple-800 border-purple-400",
    "answered-marked": "bg-purple-100 text-purple-800 border-purple-400 ring-2 ring-green-400",
  };

  function goTo(idx: number) {
    setCurrent(Math.min(Math.max(idx, 0), total - 1));
  }

  function saveAndNext() {
    if (current < total - 1) goTo(current + 1);
  }

  function markAndNext() {
    toggleMark(item.q.id);
    if (current < total - 1) goTo(current + 1);
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Link href="/dashboard" className="text-sm font-medium text-brand">
            &larr; Exit
          </Link>
          <span className="text-sm font-medium text-slate-600">{data.set.section} - Set #{data.attempt.id}</span>
          <div
            className={
              "rounded-lg border px-3 py-1 font-mono text-sm font-semibold " +
              (lowTime ? "border-red-400 bg-red-50 text-red-700" : "border-slate-300 bg-slate-50 text-slate-700")
            }
          >
            {remainingMs === null ? "--:--" : formatClock(remainingMs)}
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-6 lg:flex-row">
        <div className="flex-1">
          {item.context && (
            <div className="card mb-4 p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand">{item.contextLabel}</p>
              <div
                className="prose-cat mt-2 text-sm leading-relaxed text-slate-700"
                dangerouslySetInnerHTML={{ __html: renderContext(item.context) }}
              />
              {item.source && <p className="mt-2 text-xs text-slate-400">Source: {item.source}</p>}
            </div>
          )}

          <div className="card p-5">
            <div className="flex items-start justify-between gap-4">
              <p className="font-medium text-slate-900">
                <span className="text-slate-400">Q{current + 1} of {total}.</span>{" "}
                <span className="whitespace-pre-wrap">{withInstructionFallback(item.q)}</span>
              </p>
              <button
                onClick={() => toggleMark(item.q.id)}
                className={
                  "shrink-0 rounded-lg border px-3 py-1 text-xs font-semibold " +
                  (isMarked ? "border-purple-400 bg-purple-100 text-purple-800" : "border-slate-300 text-slate-500 hover:bg-slate-50")
                }
              >
                {isMarked ? "Marked" : "Mark for Review"}
              </button>
            </div>

            {isTita ? (
              <div className="mt-4 max-w-xs">
                <label className="label" htmlFor={`answer-${item.q.id}`}>Your answer</label>
                <input
                  id={`answer-${item.q.id}`}
                  inputMode="decimal"
                  className="input font-mono"
                  value={typedAnswer}
                  onChange={(e) => typeAnswer(item.q.id, e.target.value)}
                  placeholder="Type your answer"
                />
                <p className="mt-2 text-xs text-slate-500">
                  Type in the answer. Incorrect TITA answers do not carry negative marks.
                </p>
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                {item.q.options.map((opt, i) => {
                  const isChosen = chosen === i;
                  return (
                    <button
                      key={i}
                      onClick={() => pick(item.q.id, i)}
                      className={
                        "w-full rounded-lg border px-3 py-2 text-left text-sm " +
                        (isChosen ? "border-brand bg-brand/5" : "border-slate-300 hover:bg-slate-50")
                      }
                    >
                      <span className="font-semibold text-slate-500">{OPT[i]}.</span> {opt}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              <button className="btn-ghost" onClick={() => goTo(current - 1)} disabled={current === 0}>
                Previous
              </button>
              <button className="btn-ghost" onClick={() => clearResponse(item.q.id)} disabled={!isAnswered}>
                Clear response
              </button>
              <button className="btn-ghost" onClick={markAndNext}>
                Mark for Review &amp; Next
              </button>
              {current < total - 1 ? (
                <button className="btn-primary" onClick={saveAndNext}>
                  Save &amp; Next
                </button>
              ) : (
                <button className="btn-primary" onClick={() => setConfirmOpen(true)} disabled={busy}>
                  Submit test
                </button>
              )}
            </div>
          </div>

          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </div>

        <aside className="w-full shrink-0 lg:w-64">
          <div className="card sticky top-20 p-4">
            <p className="text-sm font-semibold text-slate-700">Question palette</p>
            <p className="mt-1 text-xs text-slate-500">
              {answeredCount} answered - {unansweredCount} remaining
            </p>
            <div className="mt-3 grid grid-cols-6 gap-1.5 lg:grid-cols-5">
              {nav.map((it, idx) => (
                <button
                  key={it.q.id}
                  onClick={() => goTo(idx)}
                  className={
                    "flex h-8 w-8 items-center justify-center rounded border text-xs font-semibold " +
                    statusStyle[statusOf(it.q.id)] +
                    (idx === current ? " ring-2 ring-brand" : "")
                  }
                >
                  {idx + 1}
                </button>
              ))}
            </div>
            <div className="mt-4 space-y-1.5 text-xs text-slate-500">
              <p><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-green-400" />Answered</p>
              <p><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-red-300" />Not answered</p>
              <p><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-purple-400" />Marked for review</p>
              <p><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-slate-200" />Not visited</p>
            </div>
            <button className="btn-primary mt-4 w-full" onClick={() => setConfirmOpen(true)} disabled={busy}>
              {busy ? "Submitting..." : "Submit test"}
            </button>
          </div>
        </aside>
      </main>

      {confirmOpen && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 px-4">
          <div className="card w-full max-w-sm p-6">
            <p className="font-semibold text-slate-900">Submit this section?</p>
            <p className="mt-2 text-sm text-slate-600">
              {unansweredCount > 0
                ? `${unansweredCount} question${unansweredCount === 1 ? "" : "s"} left unanswered. You can't change answers after submitting.`
                : "All questions answered. You can't change answers after submitting."}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setConfirmOpen(false)}>
                Keep working
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  setConfirmOpen(false);
                  submit();
                }}
                disabled={busy}
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

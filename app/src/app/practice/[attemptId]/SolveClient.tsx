"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface GenQuestion {
  id: string;
  type: string;
  prompt: string;
  options: string[];
  answer: number;
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
    answers: Record<string, number>;
  };
  set: GeneratedSet;
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

export default function SolveClient({ attemptId }: { attemptId: string }) {
  const [data, setData] = useState<AttemptData | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [reviewed, setReviewed] = useState(false);
  const [score, setScore] = useState<{ correct: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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

  const pick = useCallback(
    (qid: string, idx: number) => {
      if (reviewed) return;
      setAnswers((a) => ({ ...a, [qid]: idx }));
    },
    [reviewed],
  );

  async function submit() {
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
      setScore({ correct: d.score, total: d.total });
      setReviewed(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

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

  const questions =
    data.set.kind === "questions" ? data.set.items ?? [] : [];
  const subsets = data.set.kind === "sets" ? data.set.sets ?? [] : [];
  let n = 0;

  /** Some LLM generations forget to include the directional sentence
   * (e.g. odd-one-out prompts that show 5 numbered sentences but no
   * "identify the misfit" instruction). Prepend a fallback when we
   * detect that pattern. */
  function withInstructionFallback(q: GenQuestion): string {
    const p = q.prompt;
    // Para-jumble: numbered sentences with no "arrange" instruction
    if (
      q.type === "para_jumble" &&
      /^\s*1\.\s/.test(p) &&
      !/arrange|order|sequence/i.test(p.slice(0, 80))
    ) {
      return "Arrange the following sentences in the correct logical order.\n" + p;
    }
    // Odd-one-out: numbered sentences with no "misfit/odd one" instruction
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
    // Para-completion: paragraph with no blank or "complete" instruction
    if (
      q.type === "para_completion" &&
      !/_____|complete the|best completes|fill in the blank/i.test(p)
    ) {
      return (
        "Choose the option that best completes the paragraph below.\n" + p
      );
    }
    // Summary: paragraph with no "which best summarises" instruction
    if (
      q.type === "summary" &&
      !/summari[sz]e|main idea|best capture/i.test(p)
    ) {
      return p + "\nWhich of the following best summarises the paragraph above?";
    }
    return p;
  }

  function renderQuestion(q: GenQuestion) {
    n += 1;
    // Coerce to numbers — JSON round-trips occasionally hand us "2" instead of
    // 2, which then fails strict-equality and paints colors at random.
    const chosen =
      answers[q.id] === undefined ? undefined : Number(answers[q.id]);
    const correctIdx = Number(q.answer);
    const prompt = withInstructionFallback(q);
    return (
      <div key={q.id} className="card p-5">
        <p className="font-medium text-slate-900">
          <span className="text-slate-400">Q{n}.</span>{" "}
          <span className="whitespace-pre-wrap">{prompt}</span>
        </p>
        <div className="mt-3 space-y-2">
          {q.options.map((opt, i) => {
            const isChosen = chosen === i;
            const isCorrect = correctIdx === i;
            let cls = "border-slate-300 hover:bg-slate-50";
            if (reviewed && isCorrect) cls = "border-green-500 bg-green-50";
            else if (reviewed && isChosen && !isCorrect)
              cls = "border-red-500 bg-red-50";
            else if (isChosen) cls = "border-brand bg-brand/5";
            return (
              <div key={i}>
                <button
                  onClick={() => pick(q.id, i)}
                  disabled={reviewed}
                  className={"w-full rounded-lg border px-3 py-2 text-left text-sm " + cls}
                >
                  <span className="font-semibold text-slate-500">{OPT[i]}.</span>{" "}
                  {opt}
                </button>
                {reviewed && (
                  <p className="mt-1 px-3 text-xs text-slate-500">
                    {q.explanations[i]}
                  </p>
                )}
              </div>
            );
          })}
        </div>
        {reviewed && q.solution && (
          <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
            <span className="font-semibold text-slate-700">Solution: </span>
            <span className="whitespace-pre-wrap">{q.solution}</span>
          </div>
        )}
      </div>
    );
  }

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
          <div className="card mb-6 bg-brand p-5 text-white">
            <p className="text-lg font-semibold">
              Your score: {score.correct} / {score.total}
            </p>
            <p className="text-sm text-white/80">
              Review the explanations for every option below.
            </p>
          </div>
        )}

        {data.set.kind === "questions" && questions.length === 0 && (
          <div className="card p-5">
            <p className="font-medium text-slate-900">
              This set could not be generated.
            </p>
            <p className="mt-2 text-sm text-slate-600">
              The model was unable to produce a valid {data.set.section} set
              this time. Please go back to the dashboard and click{" "}
              <span className="font-semibold">Generate a new set</span> again -
              a fresh attempt usually succeeds.
            </p>
          </div>
        )}

        {data.set.kind === "questions" && questions.length > 0 && (
          <div className="space-y-4">{questions.map(renderQuestion)}</div>
        )}

        {data.set.kind === "sets" && subsets.length === 0 && (
          <div className="card p-5">
            <p className="font-medium text-slate-900">
              This set could not be generated.
            </p>
            <p className="mt-2 text-sm text-slate-600">
              The model was unable to produce a valid {data.set.section} set
              this time. Please go back to the dashboard and click{" "}
              <span className="font-semibold">Generate a new set</span> again -
              a fresh attempt usually succeeds.
            </p>
          </div>
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
                {ss.source && (
                  <p className="mt-2 text-xs text-slate-400">Source: {ss.source}</p>
                )}
              </div>
              <div className="space-y-4">{ss.questions.map(renderQuestion)}</div>
            </div>
          ))}

        {!reviewed && (
          <button onClick={submit} className="btn-primary mt-6" disabled={busy}>
            {busy ? "Scoring..." : "Submit answers"}
          </button>
        )}
        {reviewed && (
          <Link href="/dashboard" className="btn-ghost mt-6">
            Back to dashboard
          </Link>
        )}
      </main>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ThemeToggle from "../components/ThemeToggle";
import UserMenu from "../components/UserMenu";

const SECTIONS = ["VA", "RC", "DI", "LR", "QA"] as const;
type Section = (typeof SECTIONS)[number];

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
interface MistakeRow {
  attemptId: number;
  section: string;
  createdAt: string;
  question: GenQuestion;
  yourAnswer: string;
}

function fmtDate(s: string): string {
  const d = new Date(/T/.test(s) ? s : s.replace(" ", "T") + "Z");
  return isNaN(d.getTime()) ? s : d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export default function ReviseClient({ username }: { username: string }) {
  const [mistakes, setMistakes] = useState<MistakeRow[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Section | "ALL">("ALL");
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/revise");
        const d = await res.json();
        if (!res.ok) {
          setError(d.error || "Could not load your mistakes.");
          return;
        }
        setMistakes(d.mistakes);
      } catch {
        setError("Network error.");
      }
    })();
  }, []);

  const filtered = useMemo(
    () => (mistakes ?? []).filter((m) => filter === "ALL" || m.section === filter),
    [mistakes, filter],
  );
  const current = filtered[index] ?? null;

  function go(delta: number) {
    setRevealed(false);
    setIndex((i) => Math.min(Math.max(i + delta, 0), Math.max(filtered.length - 1, 0)));
  }
  function changeFilter(f: Section | "ALL") {
    setFilter(f);
    setIndex(0);
    setRevealed(false);
  }

  return (
    <div className="app-shell min-h-screen">
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <span className="display-type text-xl font-bold text-slate-900">CAT practice</span>
          <div className="flex items-center gap-5 text-sm">
            <Link href="/dashboard" className="font-medium text-slate-500 hover:text-brand">Dashboard</Link>
            <Link href="/analysis" className="font-medium text-slate-500 hover:text-brand">Analysis</Link>
            <Link href="/revise" className="font-medium text-brand">Revise</Link>
            <ThemeToggle />
            <UserMenu username={username} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand">Revise your mistakes</p>
        <h1 className="display-type mt-2 text-3xl font-bold text-slate-900">Every question you got wrong.</h1>
        <p className="mt-2 text-slate-500">Pulled from your own submitted attempts, most recent first.</p>

        <div className="mt-6 flex flex-wrap gap-2">
          {(["ALL", ...SECTIONS] as const).map((s) => (
            <button
              key={s}
              onClick={() => changeFilter(s)}
              className={
                "rounded-lg px-4 py-2 text-sm font-medium transition-colors " +
                (filter === s ? "bg-brand text-white" : "bg-white text-slate-600 border border-slate-300 hover:bg-slate-50")
              }
            >
              {s === "ALL" ? "All" : s}
            </button>
          ))}
        </div>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        {!mistakes ? (
          <p className="mt-6 text-sm text-slate-400">Loading...</p>
        ) : filtered.length === 0 ? (
          <div className="card mt-6 p-6 text-center">
            <p className="font-medium text-slate-900">Nothing to revise here.</p>
            <p className="mt-1 text-sm text-slate-500">
              {mistakes.length === 0
                ? "No wrong answers yet - keep practicing and this fills in automatically."
                : "No mistakes in this section - nice."}
            </p>
          </div>
        ) : current ? (
          <div className="card mt-6 p-6">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>
                {current.section} - {fmtDate(current.createdAt)}
              </span>
              <span>
                {index + 1} of {filtered.length}
              </span>
            </div>
            <p className="mt-3 whitespace-pre-wrap font-medium text-slate-900">{current.question.prompt}</p>

            {current.question.format === "tita" ? (
              <div className="mt-4 text-sm">
                <p className="text-slate-600">
                  Your answer: <span className="font-mono font-semibold text-red-600">{current.yourAnswer}</span>
                </p>
                {revealed && (
                  <p className="mt-1 text-slate-600">
                    Correct answer: <span className="font-mono font-semibold text-green-700">{String(current.question.answer)}</span>
                  </p>
                )}
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                {current.question.options.map((opt, i) => {
                  const isYours = Number(current.yourAnswer) === i;
                  const isCorrect = Number(current.question.answer) === i;
                  let cls = "border-slate-300";
                  if (revealed && isCorrect) cls = "border-green-500 bg-green-50";
                  else if (isYours) cls = "border-red-500 bg-red-50";
                  return (
                    <div key={i} className={"rounded-lg border px-3 py-2 text-sm " + cls}>
                      <span className="font-semibold text-slate-500">{String.fromCharCode(65 + i)}.</span> {opt}
                      {revealed && isCorrect && <span className="ml-2 text-xs font-semibold text-green-700">Correct</span>}
                      {isYours && <span className="ml-2 text-xs font-semibold text-red-600">Your answer</span>}
                    </div>
                  );
                })}
              </div>
            )}

            {!revealed ? (
              <button onClick={() => setRevealed(true)} className="btn-primary mt-4">
                Show explanation
              </button>
            ) : (
              <div className="mt-4 space-y-3">
                {current.question.format !== "tita" && current.question.explanations[Number(current.question.answer)] && (
                  <p className="text-sm text-slate-600">{current.question.explanations[Number(current.question.answer)]}</p>
                )}
                {current.question.solution && (
                  <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                    <span className="font-semibold text-slate-700">Solution: </span>
                    <span className="whitespace-pre-wrap">{current.question.solution}</span>
                  </div>
                )}
              </div>
            )}

            <div className="mt-6 flex justify-between">
              <button onClick={() => go(-1)} className="btn-ghost" disabled={index === 0}>
                Previous
              </button>
              <Link href={`/practice/${current.attemptId}`} className="text-sm font-medium text-brand">
                View full attempt
              </Link>
              <button onClick={() => go(1)} className="btn-ghost" disabled={index === filtered.length - 1}>
                Next
              </button>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}

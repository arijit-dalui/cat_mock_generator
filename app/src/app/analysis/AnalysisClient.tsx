"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ThemeToggle from "../components/ThemeToggle";
import UserMenu from "../components/UserMenu";

const SECTIONS = ["VA", "RC", "DI", "LR", "QA"] as const;
type Section = (typeof SECTIONS)[number];

const SECTION_NAMES: Record<Section, string> = {
  VA: "Verbal Ability",
  RC: "Reading Comprehension",
  DI: "Data Interpretation",
  LR: "Logical Reasoning",
  QA: "Quantitative Ability",
};

function fmtDate(s: string): string {
  const d = new Date(/T/.test(s) ? s : s.replace(" ", "T") + "Z");
  return isNaN(d.getTime()) ? s : d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

interface AttemptSummary {
  id: number;
  section: string;
  createdAt: string;
  correct: number;
  incorrect: number;
  unanswered: number;
  total: number;
  rawScore: number;
}
interface TopicRow {
  topic: string;
  attempts: number;
  correct: number;
  wrong: number;
}
interface PercentileInfo {
  percentile: number;
  population: number;
  rawScore: number;
}
interface HistoryResponse {
  history: AttemptSummary[];
  topics: Record<string, TopicRow[]>;
  percentile: Record<string, PercentileInfo | null>;
}

/** Friendly labels for the question `type` field, which doubles as a
 * topic tag - falls back to the raw type for anything not listed. */
const TOPIC_NAMES: Record<string, string> = {
  para_completion: "Para Completion",
  para_jumble: "Para Jumbles",
  odd_one_out: "Odd One Out",
  summary: "Para Summary",
  rc: "Reading Comprehension",
};

/** A small hand-rolled line chart - no charting library needed for one
 * polyline. Honest empty state when there's nothing to plot yet. */
function TrendChart({ points }: { points: { label: string; value: number }[] }) {
  if (points.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-slate-400">
        Take your first mock to see your trend.
      </div>
    );
  }
  const w = 560;
  const h = 160;
  const padX = 28;
  const padY = 16;
  const values = points.map((p) => p.value);
  const max = Math.max(...values, 3);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = points.length > 1 ? (w - padX * 2) / (points.length - 1) : 0;
  const coords = points.map((p, i) => {
    const x = padX + i * step;
    const y = padY + (1 - (p.value - min) / range) * (h - padY * 2);
    return { x, y, ...p };
  });
  const path = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x},${c.y}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="Score trend over time">
      <path d={path} fill="none" stroke="currentColor" strokeWidth={2} className="text-brand" />
      {coords.map((c, i) => (
        <circle key={i} cx={c.x} cy={c.y} r={3.5} className="fill-brand" />
      ))}
    </svg>
  );
}

export default function AnalysisClient({ username }: { username: string }) {
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [tab, setTab] = useState<Section>("VA");
  const [view, setView] = useState<"individual" | "comparative">("individual");
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/profile/history");
        const d = await res.json();
        if (!res.ok) {
          setError(d.error || "Failed to load analysis.");
          return;
        }
        setHistory(d);
      } catch {
        setError("Network error.");
      }
    })();
  }, []);

  const sectionHistory = (history?.history ?? []).filter((h) => h.section === tab);
  const sectionTopics = history?.topics[tab] ?? [];
  const trendPoints = sectionHistory.map((h, i) => ({ label: `#${i + 1}`, value: h.rawScore }));

  return (
    <div className="app-shell min-h-screen">
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <span className="display-type text-xl font-bold text-slate-900">CAT practice</span>
          <div className="flex items-center gap-5 text-sm">
            <Link href="/dashboard" className="font-medium text-slate-500 hover:text-brand">
              Dashboard
            </Link>
            <Link href="/analysis" className="font-medium text-brand">
              Analysis
            </Link>
            <ThemeToggle />
            <UserMenu username={username} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand">Analysis</p>
          <h1 className="display-type mt-2 text-3xl font-bold text-slate-900">Your progress, section by section.</h1>
          <p className="mt-2 text-slate-500">
            Computed from your own submitted mocks - score trend, mock history, and topic-wise accuracy.
          </p>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            {(["individual", "comparative"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={
                  "rounded-lg px-4 py-2 text-sm font-semibold capitalize " +
                  (view === v ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-600 hover:bg-slate-50")
                }
              >
                {v} performance
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {SECTIONS.map((s) => (
              <button
                key={s}
                onClick={() => setTab(s)}
                className={
                  "rounded-lg px-4 py-2 text-sm font-medium transition-colors " +
                  (tab === s
                    ? "bg-brand text-white"
                    : "bg-white text-slate-600 border border-slate-300 hover:bg-slate-50")
                }
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {view === "individual" ? (
          <>
            <section className="card mt-6 p-6">
              <p className="text-sm font-semibold text-slate-700">Score trend - {SECTION_NAMES[tab]}</p>
              <div className="mt-2 text-brand">
                <TrendChart points={trendPoints} />
              </div>
            </section>

            <section className="card mt-6 p-6">
              <p className="text-sm font-semibold text-slate-700">Mock history - {SECTION_NAMES[tab]}</p>
              {sectionHistory.length === 0 ? (
                <p className="mt-2 text-sm text-slate-400">No {tab} mocks submitted yet.</p>
              ) : (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase text-slate-400">
                        <th className="py-2">Date</th>
                        <th>Correct</th>
                        <th>Incorrect</th>
                        <th>Unanswered</th>
                        <th>Marks</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...sectionHistory].reverse().map((h) => (
                        <tr key={h.id} className="border-t border-slate-100">
                          <td className="py-2 pr-3 text-slate-600">{fmtDate(h.createdAt)}</td>
                          <td className="pr-3 font-medium text-green-600">{h.correct}</td>
                          <td className="pr-3 font-medium text-red-600">{h.incorrect}</td>
                          <td className="pr-3 text-slate-500">{h.unanswered}</td>
                          <td className="pr-3 font-semibold text-slate-900">{h.rawScore}</td>
                          <td>
                            <Link href={`/practice/${h.id}`} className="text-xs font-medium text-brand">
                              View
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="card mt-6 p-6">
              <p className="text-sm font-semibold text-slate-700">Topic accuracy - {SECTION_NAMES[tab]}</p>
              {sectionTopics.length === 0 ? (
                <p className="mt-2 text-sm text-slate-400">Submit a {tab} mock to see topic-wise accuracy.</p>
              ) : (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase text-slate-400">
                        <th className="py-2">Topic</th>
                        <th>Attempts</th>
                        <th>Correct</th>
                        <th>Wrong</th>
                        <th>Accuracy</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sectionTopics.map((t) => {
                        const acc = t.attempts > 0 ? (t.correct / t.attempts) * 100 : 0;
                        return (
                          <tr key={t.topic} className="border-t border-slate-100">
                            <td className="py-2 pr-3 font-medium text-slate-700">
                              {TOPIC_NAMES[t.topic] || t.topic}
                              {acc < 50 && (
                                <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-600">
                                  Weak
                                </span>
                              )}
                            </td>
                            <td className="pr-3">{t.attempts}</td>
                            <td className="pr-3 font-medium text-green-600">{t.correct}</td>
                            <td className="pr-3 font-medium text-red-600">{t.wrong}</td>
                            <td className="pr-3 font-semibold text-slate-900">{acc.toFixed(0)}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        ) : (
          <ComparativePanel section={tab} info={history?.percentile[tab] ?? null} />
        )}
      </main>
    </div>
  );
}

/** Where this user's latest attempt in a section stands against every
 * submitted attempt in that section, across every user. Real population
 * data - shows an honest "not enough attempts yet" state instead of a
 * meaningless 100th percentile when the population is too small. */
function ComparativePanel({ section, info }: { section: Section; info: PercentileInfo | null }) {
  return (
    <section className="card mt-6 p-6">
      <p className="text-sm font-semibold text-slate-700">Comparative standing - {SECTION_NAMES[section]}</p>
      {!info ? (
        <p className="mt-3 text-sm text-slate-400">
          Not enough submitted {section} attempts yet (from you or other users) to compute a comparison.
          This fills in automatically as more mocks get submitted.
        </p>
      ) : (
        <div className="mt-4">
          <p className="text-4xl font-bold text-slate-900">
            {info.percentile.toFixed(1)}
            <span className="text-lg font-medium text-slate-400">th percentile</span>
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Your latest {section} attempt scored {info.rawScore} marks - better than {info.percentile.toFixed(0)}%
            of {info.population} submitted {section} attempts across all users.
          </p>
          <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-brand" style={{ width: `${info.percentile}%` }} />
          </div>
        </div>
      )}
    </section>
  );
}

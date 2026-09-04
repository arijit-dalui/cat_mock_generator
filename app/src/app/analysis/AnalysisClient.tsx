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
function TrendChart({ points }: { points: { label: string; value: number; date: string }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-slate-400">
        Take your first mock to see your trend.
      </div>
    );
  }
  const w = 560;
  const h = 190;
  const padLeft = 40;
  const padRight = 16;
  const padTop = 16;
  const padBottom = 28;
  const plotW = w - padLeft - padRight;
  const plotH = h - padTop - padBottom;
  const values = points.map((p) => p.value);
  const max = Math.max(...values, 3);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = points.length > 1 ? plotW / (points.length - 1) : 0;
  const coords = points.map((p, i) => {
    const x = padLeft + i * step;
    const y = padTop + (1 - (p.value - min) / range) * plotH;
    return { x, y, ...p };
  });
  const path = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x},${c.y}`).join(" ");
  // Thin out x-axis labels so they don't overlap when there are many points.
  const labelEvery = Math.max(1, Math.ceil(points.length / 8));
  const zeroY = padTop + (1 - (0 - min) / range) * plotH;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="Score trend over time">
      {/* Axes */}
      <line x1={padLeft} y1={padTop} x2={padLeft} y2={padTop + plotH} className="stroke-slate-300" strokeWidth={1} />
      <line x1={padLeft} y1={padTop + plotH} x2={padLeft + plotW} y2={padTop + plotH} className="stroke-slate-300" strokeWidth={1} />
      {/* Zero line, when it's inside the plotted range and not the axis itself */}
      {min < 0 && max > 0 && (
        <line x1={padLeft} y1={zeroY} x2={padLeft + plotW} y2={zeroY} className="stroke-slate-200" strokeWidth={1} strokeDasharray="3 3" />
      )}
      {/* Y-axis labels: max, zero-or-min, min */}
      <text x={padLeft - 6} y={padTop + 4} textAnchor="end" fontSize="10" className="fill-slate-400">{max.toFixed(0)}</text>
      <text x={padLeft - 6} y={padTop + plotH + 4} textAnchor="end" fontSize="10" className="fill-slate-400">{min.toFixed(0)}</text>
      <text x={padLeft - 26} y={padTop + plotH / 2} textAnchor="middle" fontSize="9" className="fill-slate-400" transform={`rotate(-90 ${padLeft - 26} ${padTop + plotH / 2})`}>Marks</text>
      {/* X-axis labels */}
      {coords.map((c, i) =>
        i % labelEvery === 0 || i === coords.length - 1 ? (
          <text key={`lbl-${i}`} x={c.x} y={h - 8} textAnchor="middle" fontSize="10" className="fill-slate-400">{c.label}</text>
        ) : null,
      )}
      <path d={path} fill="none" stroke="currentColor" strokeWidth={2} className="text-brand" />
      {coords.map((c, i) => (
        <g key={i}>
          {/* Fat invisible hit-target so hovering near a point is easy, not just the 3.5px dot */}
          <circle
            cx={c.x}
            cy={c.y}
            r={10}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover((h) => (h === i ? null : h))}
            style={{ cursor: "pointer" }}
          />
          <circle cx={c.x} cy={c.y} r={hover === i ? 5 : 3.5} className="fill-brand" style={{ pointerEvents: "none" }} />
        </g>
      ))}
      {hover !== null && (
        <g style={{ pointerEvents: "none" }}>
          <line x1={coords[hover].x} y1={padTop} x2={coords[hover].x} y2={padTop + plotH} className="stroke-slate-300" strokeWidth={1} strokeDasharray="2 2" />
          {(() => {
            const c = coords[hover];
            const boxW = 92;
            const boxX = Math.min(Math.max(c.x - boxW / 2, 2), w - boxW - 2);
            const boxY = c.y > padTop + 30 ? c.y - 40 : c.y + 10;
            return (
              <g transform={`translate(${boxX},${boxY})`}>
                <rect width={boxW} height={32} rx={4} className="fill-slate-900" opacity={0.9} />
                <text x={boxW / 2} y={13} textAnchor="middle" fontSize="10" fill="#fff" fontWeight={700}>
                  {c.value} marks
                </text>
                <text x={boxW / 2} y={25} textAnchor="middle" fontSize="9" fill="#cbd5e1">
                  {c.date}
                </text>
              </g>
            );
          })()}
        </g>
      )}
    </svg>
  );
}

/** Stacked correct/incorrect/unanswered bar per test, most recent last -
 * the per-test companion to the score-trend line above. Hover a bar for
 * the exact breakdown. */
function ResultsBarChart({ attempts }: { attempts: AttemptSummary[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (attempts.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-slate-400">
        Take your first mock to see this.
      </div>
    );
  }
  const w = 560;
  const h = 190;
  const padLeft = 32;
  const padRight = 16;
  const padTop = 16;
  const padBottom = 28;
  const plotW = w - padLeft - padRight;
  const plotH = h - padTop - padBottom;
  const maxTotal = Math.max(...attempts.map((a) => a.total), 1);
  const gap = 6;
  const barW = Math.min(36, (plotW - gap * (attempts.length - 1)) / attempts.length);
  const rowsW = barW * attempts.length + gap * (attempts.length - 1);
  const startX = padLeft + (plotW - rowsW) / 2;
  const labelEvery = Math.max(1, Math.ceil(attempts.length / 8));

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="Correct vs incorrect per test">
      <line x1={padLeft} y1={padTop} x2={padLeft} y2={padTop + plotH} className="stroke-slate-300" strokeWidth={1} />
      <line x1={padLeft} y1={padTop + plotH} x2={padLeft + plotW} y2={padTop + plotH} className="stroke-slate-300" strokeWidth={1} />
      {attempts.map((a, i) => {
        const x = startX + i * (barW + gap);
        const correctH = (a.correct / maxTotal) * plotH;
        const incorrectH = (a.incorrect / maxTotal) * plotH;
        const unansweredH = (a.unanswered / maxTotal) * plotH;
        let y = padTop + plotH;
        const segs: { h: number; color: string }[] = [
          { h: correctH, color: "#3fa84a" },
          { h: incorrectH, color: "#d9534f" },
          { h: unansweredH, color: "#cbd5e1" },
        ];
        return (
          <g key={a.id} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover((v) => (v === i ? null : v))} style={{ cursor: "pointer" }}>
            <rect x={x} y={padTop} width={barW} height={plotH} fill="transparent" />
            {segs.map((s, si) => {
              y -= s.h;
              return s.h > 0 ? <rect key={si} x={x} y={y} width={barW} height={s.h} fill={s.color} opacity={hover === i ? 1 : 0.85} /> : null;
            })}
            {(i % labelEvery === 0 || i === attempts.length - 1) && (
              <text x={x + barW / 2} y={h - 8} textAnchor="middle" fontSize="10" className="fill-slate-400">#{i + 1}</text>
            )}
          </g>
        );
      })}
      {hover !== null && (
        <g style={{ pointerEvents: "none" }} transform={`translate(${Math.min(Math.max(startX + hover * (barW + gap) - 30, 2), w - 122)}, ${padTop})`}>
          <rect width={120} height={44} rx={4} className="fill-slate-900" opacity={0.9} />
          <text x={60} y={13} textAnchor="middle" fontSize="10" fill="#4ade80">{attempts[hover].correct} correct</text>
          <text x={60} y={25} textAnchor="middle" fontSize="10" fill="#f87171">{attempts[hover].incorrect} incorrect</text>
          <text x={60} y={37} textAnchor="middle" fontSize="10" fill="#cbd5e1">{attempts[hover].unanswered} unanswered</text>
        </g>
      )}
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
  const trendPoints = sectionHistory.map((h, i) => ({ label: `#${i + 1}`, value: h.rawScore, date: fmtDate(h.createdAt) }));

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
              <p className="text-sm font-semibold text-slate-700">Correct vs incorrect, per test - {SECTION_NAMES[tab]}</p>
              <div className="mt-2">
                <ResultsBarChart attempts={sectionHistory} />
              </div>
              <div className="mt-2 flex gap-4 text-xs text-slate-500">
                <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "#3fa84a" }} />Correct</span>
                <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "#d9534f" }} />Incorrect</span>
                <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "#cbd5e1" }} />Unanswered</span>
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

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import NavHeader from "../components/NavHeader";
import PageHeader from "../components/PageHeader";
import SegmentedTabs from "../components/SegmentedTabs";

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
interface MockHistoryRow {
  id: number;
  createdAt: string;
  phases: Record<string, number>;
  total: number;
  percentile: number | null;
  population: number;
}
interface HistoryResponse {
  history: AttemptSummary[];
  topics: Record<string, TopicRow[]>;
  percentile: Record<string, PercentileInfo | null>;
  overallPercentile: number | null;
  mockHistory: MockHistoryRow[];
}
interface LeaderboardRow {
  username: string;
  best_score: number;
  created_at: string | null;
  submitted_at: string | null;
}

/** "12m 30s" between two timestamps - the real time that attempt/mock took,
 * not a fabricated number. Handles the naive-UTC SQLite string format the
 * same way fmtDate does. */
function fmtDuration(createdAt: string | null, submittedAt: string | null): string | null {
  if (!createdAt || !submittedAt) return null;
  const toDate = (s: string) => new Date(/T/.test(s) ? s : s.replace(" ", "T") + "Z");
  const ms = toDate(submittedAt).getTime() - toDate(createdAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
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
                <rect width={boxW} height={32} rx={2} fill="#1a1714" opacity={0.92} />
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
          <rect width={120} height={44} rx={2} fill="#1a1714" opacity={0.92} />
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
  const [scope, setScope] = useState<"sectional" | "mock">("sectional");
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[] | null>(null);
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

  useEffect(() => {
    if (view !== "comparative") return;
    setLeaderboard(null);
    (async () => {
      try {
        const qs = scope === "mock" ? "scope=mock" : `section=${tab}`;
        const res = await fetch(`/api/leaderboard?${qs}`);
        const d = await res.json();
        if (res.ok) setLeaderboard(d.leaderboard);
      } catch {
        /* non-fatal - the leaderboard card just shows its empty state */
      }
    })();
  }, [view, scope, tab]);

  const sectionHistory = (history?.history ?? []).filter((h) => h.section === tab);
  const sectionTopics = history?.topics[tab] ?? [];
  const trendPoints = sectionHistory.map((h, i) => ({ label: `#${i + 1}`, value: h.rawScore, date: fmtDate(h.createdAt) }));

  const mockHistory = history?.mockHistory ?? [];
  const mockTrendPoints = mockHistory.map((m, i) => ({ label: `#${i + 1}`, value: m.total, date: fmtDate(m.createdAt) }));

  return (
    <div className="app-shell min-h-screen">
      <NavHeader active="/analysis" username={username} />

      <main className="mx-auto max-w-5xl px-6 py-8">
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        <PageHeader
          eyebrow="Analysis"
          title="Your progress, section by section."
          subtitle="Computed from your own submitted mocks - score trend, mock history, and topic-wise accuracy."
        />

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <SegmentedTabs
            options={["individual", "comparative"] as const}
            value={view}
            onChange={setView}
            labels={{ individual: "Individual performance", comparative: "Comparative performance" }}
          />
          {scope === "sectional" && <SegmentedTabs options={SECTIONS} value={tab} onChange={setTab} />}
        </div>

        <div className="mt-4">
          <SegmentedTabs
            options={["sectional", "mock"] as const}
            value={scope}
            onChange={setScope}
            labels={{ sectional: "Sectional", mock: "Full Mock" }}
          />
        </div>

        {view === "individual" && scope === "mock" ? (
          <>
            <section className="card mt-6 p-6">
              <p className="card-title">Score trend - Full Mock</p>
              <div className="mt-2 text-brand">
                <TrendChart points={mockTrendPoints} />
              </div>
            </section>

            <section className="card mt-6 p-6">
              <p className="card-title">Full Mock history</p>
              {mockHistory.length === 0 ? (
                <p className="mt-2 text-sm text-slate-400">No full mocks submitted yet.</p>
              ) : (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase text-slate-400">
                        <th className="py-2">Date</th>
                        <th>VARC</th>
                        <th>DILR</th>
                        <th>QA</th>
                        <th>Total</th>
                        <th>Percentile</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...mockHistory].reverse().map((m) => (
                        <tr key={m.id} className="border-t border-slate-100">
                          <td className="py-2 pr-3 text-slate-600">{fmtDate(m.createdAt)}</td>
                          <td className="pr-3 font-mono text-slate-700">{m.phases.VARC ?? 0}</td>
                          <td className="pr-3 font-mono text-slate-700">{m.phases.DILR ?? 0}</td>
                          <td className="pr-3 font-mono text-slate-700">{m.phases.QA ?? 0}</td>
                          <td className="pr-3 font-semibold text-slate-900">{m.total}</td>
                          <td className="pr-3 font-mono text-slate-700">
                            {m.percentile == null ? "-" : `${m.percentile.toFixed(1)}%ile`}
                          </td>
                          <td>
                            <Link href={`/mocks/${m.id}`} className="text-xs font-medium text-brand">
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
          </>
        ) : view === "individual" ? (
          <>
            <section className="card mt-6 p-6">
              <p className="card-title">Score trend - {SECTION_NAMES[tab]}</p>
              <div className="mt-2 text-brand">
                <TrendChart points={trendPoints} />
              </div>
            </section>

            <section className="card mt-6 p-6">
              <p className="card-title">Correct vs incorrect, per test - {SECTION_NAMES[tab]}</p>
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
              <p className="card-title">Mock history - {SECTION_NAMES[tab]}</p>
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
              <p className="card-title">Topic accuracy - {SECTION_NAMES[tab]}</p>
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
                        const weak = acc < 50;
                        return (
                          <tr
                            key={t.topic}
                            className="border-t border-slate-100"
                            style={weak ? { background: "var(--danger-pale)" } : undefined}
                          >
                            <td className="py-2 pr-3 font-medium text-slate-700">
                              {TOPIC_NAMES[t.topic] || t.topic}
                              {weak && (
                                <span className="ml-2 rounded-sm bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">
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
        ) : scope === "mock" ? (
          <>
            <ComparativeMockPanel latest={mockHistory[mockHistory.length - 1] ?? null} />
            <Leaderboard title="Full Mock Leaderboard" rows={leaderboard} viewerUsername={username} unit="marks" />
          </>
        ) : (
          <>
            <section className="card mt-6 p-6">
              <p className="card-eyebrow">Overall percentile</p>
              {history?.overallPercentile == null ? (
                <p className="mt-2 text-sm text-slate-400">
                  Not enough data across sections yet to compute an overall standing.
                </p>
              ) : (
                <>
                  <p className="mt-2 font-serif text-4xl font-bold text-brand">
                    {history.overallPercentile.toFixed(1)}
                    <span className="font-sans text-lg font-medium text-slate-400">th percentile</span>
                  </p>
                  <p className="mt-1 text-sm text-slate-500">Average of your per-section percentiles below.</p>
                </>
              )}
            </section>
            <ComparativePanel section={tab} info={history?.percentile[tab] ?? null} />
            <Leaderboard title={`Leaderboard - ${SECTION_NAMES[tab]}`} rows={leaderboard} viewerUsername={username} unit="marks" />
          </>
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
      <p className="card-eyebrow">Comparative standing - {SECTION_NAMES[section]}</p>
      {!info ? (
        <p className="mt-3 text-sm text-slate-400">
          Not enough submitted {section} attempts yet (from you or other users) to compute a comparison.
          This fills in automatically as more mocks get submitted.
        </p>
      ) : (
        <div className="mt-4">
          <p className="font-serif text-4xl font-bold text-brand">
            {info.percentile.toFixed(1)}
            <span className="font-sans text-lg font-medium text-slate-400">th percentile</span>
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

/** Comparative standing for the user's most recent full mock - same honest
 * "not enough data" rule as the sectional panel above. */
function ComparativeMockPanel({ latest }: { latest: MockHistoryRow | null }) {
  return (
    <section className="card mt-6 p-6">
      <p className="card-eyebrow">Comparative standing - Full Mock</p>
      {!latest || latest.percentile == null ? (
        <p className="mt-3 text-sm text-slate-400">
          Not enough submitted full mocks yet (from you or other users) to compute a comparison.
          This fills in automatically as more mocks get submitted.
        </p>
      ) : (
        <div className="mt-4">
          <p className="font-serif text-4xl font-bold text-brand">
            {latest.percentile.toFixed(1)}
            <span className="font-sans text-lg font-medium text-slate-400">th percentile</span>
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Your latest full mock scored {latest.total} marks - better than {latest.percentile.toFixed(0)}%
            of {latest.population} submitted full mocks across all users.
          </p>
          <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-brand" style={{ width: `${latest.percentile}%` }} />
          </div>
        </div>
      )}
    </section>
  );
}

/** Top 10 by best score in a section, from real submitted attempts. Click a
 * row to see that person's public profile (best scores + whatever links
 * they've chosen to share - never anything private). */
const PODIUM_ORDER = [1, 0, 2]; // display order: 2nd, 1st, 3rd, tallest bar in the middle

function Leaderboard({
  title,
  rows,
  viewerUsername,
  unit,
}: {
  title: string;
  rows: LeaderboardRow[] | null;
  viewerUsername: string;
  unit: string;
}) {
  if (rows === null) {
    return (
      <section className="card mt-6 p-6">
        <p className="card-title">{title}</p>
        <p className="mt-2 text-sm text-slate-400">Loading...</p>
      </section>
    );
  }
  if (rows.length === 0) {
    return (
      <section className="card mt-6 p-6">
        <p className="card-title">{title}</p>
        <p className="mt-2 text-sm text-slate-400">No submitted attempts yet.</p>
      </section>
    );
  }

  const top3 = rows.slice(0, 3);
  // Fixed per-rank heights (gold tallest, silver, bronze) - a podium reads
  // by position, not by how close the actual scores happen to be.
  const RANK_HEIGHT = [140, 100, 70];
  const RANK_COLOR = ["#BF4E2B", "#9AA0AC", "#B08D57"]; // gold(brand)/silver/bronze

  return (
    <section className="card mt-6 p-6">
      <p className="card-title">{title}</p>

      {/* Podium - top 3, 2nd/1st/3rd left-to-right, tallest in the middle */}
      <div className="mt-6 flex items-end justify-center gap-4">
        {PODIUM_ORDER.filter((i) => i < top3.length).map((i) => {
          const r = top3[i];
          const rank = i + 1;
          const time = fmtDuration(r.created_at, r.submitted_at);
          return (
            <div key={r.username} className="flex w-28 flex-col items-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">
                {r.username.charAt(0).toUpperCase()}
              </div>
              <Link
                href={`/u/${encodeURIComponent(r.username)}`}
                className="mt-2 max-w-full truncate text-sm font-medium text-slate-900 hover:text-brand"
              >
                {r.username}
                {r.username === viewerUsername && " (you)"}
              </Link>
              <div
                className="mt-2 flex w-full flex-col items-center justify-start rounded-sm pt-2"
                style={{ height: RANK_HEIGHT[i], background: RANK_COLOR[i] }}
              >
                <span className="font-mono text-xs font-bold text-white">#{rank}</span>
              </div>
              <p className="mt-1 font-mono text-xs text-slate-500">
                {r.best_score} {unit}
                {time && ` · ${time}`}
              </p>
            </div>
          );
        })}
      </div>

      {/* Full list */}
      <ol className="mt-6 divide-y divide-slate-100 border-t border-slate-100">
        {rows.map((r, i) => {
          const time = fmtDuration(r.created_at, r.submitted_at);
          return (
            <li key={r.username}>
              <Link
                href={`/u/${encodeURIComponent(r.username)}`}
                className={
                  "flex items-center justify-between px-2 py-3 text-sm transition-colors hover:bg-slate-50 " +
                  (r.username === viewerUsername ? "bg-brand/5 font-semibold text-brand" : "text-slate-700")
                }
              >
                <span className="flex items-center gap-3">
                  <span className="w-6 text-right font-mono text-xs text-slate-400">{i + 1}</span>
                  <span>
                    {r.username}
                    {r.username === viewerUsername && " (you)"}
                  </span>
                </span>
                <span className="flex items-center gap-4 font-mono text-xs text-slate-400">
                  {time && <span>{time}</span>}
                  <span className="text-sm font-semibold">
                    {r.best_score} {unit}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

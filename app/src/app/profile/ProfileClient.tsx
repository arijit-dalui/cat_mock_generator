"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ThemeToggle from "../components/ThemeToggle";

const SECTIONS = ["VA", "RC", "DI", "LR", "QA"] as const;
type Section = (typeof SECTIONS)[number];

const SECTION_NAMES: Record<Section, string> = {
  VA: "Verbal Ability",
  RC: "Reading Comprehension",
  DI: "Data Interpretation",
  LR: "Logical Reasoning",
  QA: "Quantitative Ability",
};

interface AppStat {
  attempts: number;
  solved: number;
  correct: number;
}
interface ExtStat {
  solved: number;
  accuracy: number | null;
}
interface StatsResponse {
  app: Record<string, AppStat>;
  external: Record<string, ExtStat>;
}

/** Editable form state for the "other sources" inputs (strings while typing). */
interface ExtForm {
  solved: string;
  accuracy: string;
  saving: boolean;
  saved: boolean;
}

function pct(correct: number, solved: number): number | null {
  return solved > 0 ? (correct / solved) * 100 : null;
}

function fmtDate(s: string): string {
  const d = new Date(/T/.test(s) ? s : s.replace(" ", "T") + "Z");
  return isNaN(d.getTime()) ? s : d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function barColor(p: number): string {
  if (p >= 75) return "bg-green-500";
  if (p >= 50) return "bg-amber-500";
  return "bg-red-500";
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
interface HistoryResponse {
  history: AttemptSummary[];
  topics: Record<string, TopicRow[]>;
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

export default function ProfileClient({
  username,
  role,
  createdAt,
}: {
  username: string;
  role: string;
  createdAt: string;
}) {
  const router = useRouter();
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [analysisTab, setAnalysisTab] = useState<Section>("VA");
  const [error, setError] = useState("");
  const [forms, setForms] = useState<Record<string, ExtForm>>({});

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/profile/history");
        const d = await res.json();
        if (res.ok) setHistory(d);
      } catch {
        /* non-fatal - the trend/topic sections just show their empty state */
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/profile/stats");
        const d = await res.json();
        if (!res.ok) {
          setError(d.error || "Failed to load stats.");
          return;
        }
        setStats(d);
        const f: Record<string, ExtForm> = {};
        for (const s of SECTIONS) {
          const ext = d.external[s] as ExtStat | undefined;
          f[s] = {
            solved: ext && ext.solved ? String(ext.solved) : "",
            accuracy: ext && ext.accuracy != null ? String(ext.accuracy) : "",
            saving: false,
            saved: false,
          };
        }
        setForms(f);
      } catch {
        setError("Network error.");
      }
    })();
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  function setForm(section: Section, patch: Partial<ExtForm>) {
    setForms((prev) => ({ ...prev, [section]: { ...prev[section], ...patch } }));
  }

  async function saveExternal(section: Section) {
    const form = forms[section];
    if (!form) return;
    setForm(section, { saving: true, saved: false });
    try {
      const res = await fetch("/api/profile/external", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section,
          solved: form.solved,
          accuracy: form.accuracy,
        }),
      });
      if (!res.ok) {
        setError("Could not save other-source numbers.");
        return;
      }
      // Reflect the saved values into the stats so totals update immediately.
      setStats((prev) =>
        prev
          ? {
              ...prev,
              external: {
                ...prev.external,
                [section]: {
                  solved: Math.max(0, Math.floor(Number(form.solved) || 0)),
                  accuracy: form.accuracy === "" ? null : Number(form.accuracy),
                },
              },
            }
          : prev,
      );
      setForm(section, { saved: true });
      setTimeout(() => setForm(section, { saved: false }), 1500);
    } catch {
      setError("Network error.");
    } finally {
      setForm(section, { saving: false });
    }
  }

  const overall = useMemo(() => {
    if (!stats) return null;
    let attempts = 0;
    let solved = 0;
    let correct = 0;
    let extSolved = 0;
    let best: { section: string; acc: number } | null = null;
    for (const s of SECTIONS) {
      const a = stats.app[s];
      attempts += a.attempts;
      solved += a.solved;
      correct += a.correct;
      extSolved += stats.external[s]?.solved ?? 0;
      const p = pct(a.correct, a.solved);
      if (p != null && (!best || p > best.acc)) best = { section: s, acc: p };
    }
    return { attempts, solved, correct, extSolved, best };
  }, [stats]);

  if (error)
    return (
      <main className="mx-auto max-w-4xl px-6 py-10">
        <p className="text-red-600">{error}</p>
        <Link href="/dashboard" className="btn-ghost mt-4">
          Back to dashboard
        </Link>
      </main>
    );
  if (!stats || !overall)
    return <main className="mx-auto max-w-4xl px-6 py-10 text-slate-400">Loading...</main>;

  const overallAcc = pct(overall.correct, overall.solved);
  const grandSolved = overall.solved + overall.extSolved;

  return (
    <div className="app-shell min-h-screen">
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <Link href="/dashboard" className="text-sm font-medium text-brand">
            &larr; Dashboard
          </Link>
          <div className="flex items-center gap-3"><ThemeToggle /><button onClick={logout} className="btn-ghost">Log out</button></div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8 space-y-8">
        {/* Profile header */}
        <section className="card flex items-center gap-5 p-6">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-brand text-2xl font-bold text-white">
            {username.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900">{username}</h1>
              <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold uppercase text-slate-500">
                {role}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-500">Member since {fmtDate(createdAt)}</p>
          </div>
        </section>

        {/* Overall tracker */}
        <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Sets attempted" value={overall.attempts} />
          <Stat label="Questions solved" value={grandSolved} />
          <Stat
            label="Overall accuracy"
            value={overallAcc == null ? "-" : `${overallAcc.toFixed(1)}%`}
          />
          <Stat
            label="Strongest section"
            value={overall.best ? overall.best.section : "-"}
            sub={overall.best ? `${overall.best.acc.toFixed(0)}%` : undefined}
          />
        </section>

        {/* Analysis: score trend, mock history, topic accuracy - all
         * computed from this user's own submitted attempts, nothing
         * modeled or fabricated. */}
        <section className="card p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="display-type text-2xl font-bold text-slate-900">Your analysis</h2>
            <div className="flex flex-wrap gap-2">
              {SECTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setAnalysisTab(s)}
                  className={
                    "rounded-lg px-3 py-1.5 text-xs font-semibold " +
                    (analysisTab === s
                      ? "bg-brand text-white"
                      : "border border-slate-300 text-slate-600 hover:bg-slate-50")
                  }
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {(() => {
            const sectionHistory = (history?.history ?? []).filter((h) => h.section === analysisTab);
            const sectionTopics = history?.topics[analysisTab] ?? [];
            const trendPoints = sectionHistory.map((h, i) => ({
              label: `#${i + 1}`,
              value: h.rawScore,
            }));
            return (
              <>
                <div className="mt-5">
                  <p className="text-sm font-semibold text-slate-700">
                    Score trend - {SECTION_NAMES[analysisTab]}
                  </p>
                  <div className="mt-2 text-brand">
                    <TrendChart points={trendPoints} />
                  </div>
                </div>

                <div className="mt-8">
                  <p className="text-sm font-semibold text-slate-700">Mock history</p>
                  {sectionHistory.length === 0 ? (
                    <p className="mt-2 text-sm text-slate-400">
                      No {analysisTab} mocks submitted yet.
                    </p>
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
                </div>

                <div className="mt-8">
                  <p className="text-sm font-semibold text-slate-700">
                    Topic accuracy - {SECTION_NAMES[analysisTab]}
                  </p>
                  {sectionTopics.length === 0 ? (
                    <p className="mt-2 text-sm text-slate-400">
                      Submit a {analysisTab} mock to see topic-wise accuracy.
                    </p>
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
                </div>
              </>
            );
          })()}
        </section>

        {/* Per-section tracker */}
        <section className="card p-6">
          <h2 className="display-type text-2xl font-bold text-slate-900">Your practice, by section</h2>
          <p className="mt-1 text-sm text-slate-500">Look for a steady direction, not a perfect day.</p>
          <div className="mt-4 space-y-4">
            {SECTIONS.map((s) => {
              const a = stats.app[s];
              const p = pct(a.correct, a.solved);
              return (
                <div key={s}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-700">
                      {s}{" "}
                      <span className="text-slate-400">— {SECTION_NAMES[s]}</span>
                    </span>
                    <span className="text-slate-500">
                      {a.solved} solved · {a.attempts} sets ·{" "}
                      {p == null ? "—" : `${p.toFixed(0)}%`}
                    </span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={"h-full rounded-full " + (p == null ? "bg-slate-200" : barColor(p))}
                      style={{ width: `${p ?? 0}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Other sources */}
        <section className="card p-6">
          <h2 className="display-type text-2xl font-bold text-slate-900">Practice beyond this desk</h2>
          <p className="mt-1 text-sm text-slate-500">
            Practiced elsewhere (books, other mocks)? Log it here to track your
            full effort. Accuracy is a percentage.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-400">
                  <th className="py-2">Section</th>
                  <th>Solved</th>
                  <th>Accuracy %</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {SECTIONS.map((s) => {
                  const f = forms[s] ?? { solved: "", accuracy: "", saving: false, saved: false };
                  return (
                    <tr key={s} className="border-t border-slate-100">
                      <td className="py-2 pr-3 font-medium text-slate-700">{s}</td>
                      <td className="pr-3">
                        <input
                          type="number"
                          min={0}
                          className="input w-24"
                          value={f.solved}
                          onChange={(e) => setForm(s, { solved: e.target.value })}
                          placeholder="0"
                        />
                      </td>
                      <td className="pr-3">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          className="input w-24"
                          value={f.accuracy}
                          onChange={(e) => setForm(s, { accuracy: e.target.value })}
                          placeholder="0"
                        />
                      </td>
                      <td>
                        <button
                          onClick={() => saveExternal(s)}
                          disabled={f.saving}
                          className="btn-ghost"
                        >
                          {f.saving ? "..." : f.saved ? "Saved ✓" : "Save"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat label="Solved (other sources)" value={overall.extSolved} />
            <Stat label="Solved (in-app)" value={overall.solved} />
            <Stat label="Total solved (all)" value={grandSolved} highlight />
          </div>
        </section>
      </main>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: number | string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div className={"card p-5 " + (highlight ? "border-brand bg-brand/5" : "")}>
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-3xl font-bold text-slate-900">{value}</p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

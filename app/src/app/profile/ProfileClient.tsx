"use client";

import { useEffect, useMemo, useState } from "react";
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

/** Hidden per request - kept in code (not deleted) in case logging practice
 * from outside this app turns out to be worth surfacing again later. */
const SHOW_EXTERNAL_STATS = false;

export default function ProfileClient({
  username,
  role,
  createdAt,
}: {
  username: string;
  role: string;
  createdAt: string;
}) {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [error, setError] = useState("");
  const [forms, setForms] = useState<Record<string, ExtForm>>({});

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
          <span className="display-type text-xl font-bold text-slate-900">CAT practice</span>
          <div className="flex items-center gap-5 text-sm">
            <Link href="/dashboard" className="font-medium text-slate-500 hover:text-brand">
              Dashboard
            </Link>
            <Link href="/analysis" className="font-medium text-slate-500 hover:text-brand">
              Analysis
            </Link>
            <ThemeToggle />
            <UserMenu username={username} role={role} />
          </div>
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
        {SHOW_EXTERNAL_STATS && (
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
        )}
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

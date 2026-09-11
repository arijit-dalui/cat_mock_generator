"use client";

import { useEffect, useState } from "react";
import AdminNavHeader from "../components/AdminNavHeader";

const SECTIONS = ["VA", "RC", "DI", "LR", "QA"] as const;

interface Stats {
  totalUsers: number;
  recentRegistrations: { d: string; c: number }[];
  dau: { d: string; c: number }[];
  generated: Record<string, { count: number }>;
  solved: Record<string, { count: number; avgScore?: number | null }>;
}

// Slice colours for the question-distribution pie (one per section).
const SECTION_COLORS: Record<string, string> = {
  VA: "#2563eb",
  RC: "#16a34a",
  DI: "#d97706",
  LR: "#9333ea",
  QA: "#dc2626",
};

export default function AdminClient({ username }: { username: string }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/stats");
        const d = await res.json();
        if (res.ok) setStats(d);
        else setError(d.error || "Failed to load stats.");
      } catch {
        setError("Network error.");
      }
    })();
  }, []);

  if (error)
    return (
      <div className="app-shell min-h-screen">
        <AdminNavHeader active="/admin" username={username} />
        <main className="mx-auto max-w-4xl px-6 py-10">
          <p className="text-red-600">{error}</p>
        </main>
      </div>
    );
  if (!stats)
    return (
      <div className="app-shell min-h-screen">
        <AdminNavHeader active="/admin" username={username} />
        <main className="mx-auto max-w-4xl px-6 py-10 text-slate-400">Loading...</main>
      </div>
    );

  // Question distribution across sections, as a share of total generated.
  const dist = SECTIONS.map((s) => ({
    section: s,
    count: stats.generated[s]?.count ?? 0,
    color: SECTION_COLORS[s],
  }));
  const distTotal = dist.reduce((n, d) => n + d.count, 0);
  // Build conic-gradient stops so each slice is its share of 100%.
  let acc = 0;
  const gradientStops = dist
    .map((d) => {
      const start = distTotal ? (acc / distTotal) * 100 : 0;
      acc += d.count;
      const end = distTotal ? (acc / distTotal) * 100 : 0;
      return `${d.color} ${start}% ${end}%`;
    })
    .join(", ");

  return (
    <div className="app-shell min-h-screen">
      <AdminNavHeader active="/admin" username={username} />

      <main className="mx-auto max-w-4xl px-6 py-8 space-y-8">
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat label="Registered users" value={stats.totalUsers} />
          <Stat
            label="Registrations in last 30 days"
            value={stats.recentRegistrations.reduce((n, r) => n + r.c, 0)}
          />
          <Stat
            label="Distinct visitors today"
            value={
              stats.dau.find((d) => d.d === today())?.c ?? 0
            }
          />
        </section>

        <section className="card p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Question distribution by section
          </h2>
          {distTotal === 0 ? (
            <p className="mt-4 text-sm text-slate-400">No questions generated yet.</p>
          ) : (
            <div className="mt-4 flex flex-wrap items-center gap-8">
              <div
                className="h-40 w-40 shrink-0 rounded-full"
                style={{ background: `conic-gradient(${gradientStops})` }}
                aria-label="Question distribution pie chart"
              />
              <ul className="space-y-2 text-sm">
                {dist.map((d) => {
                  const pct = distTotal ? (d.count / distTotal) * 100 : 0;
                  return (
                    <li key={d.section} className="flex items-center gap-2">
                      <span
                        className="inline-block h-3 w-3 rounded-sm"
                        style={{ background: d.color }}
                      />
                      <span className="font-medium text-slate-700">{d.section}</span>
                      <span className="text-slate-400">
                        {pct.toFixed(1)}% ({d.count})
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>

        <section className="card p-6 overflow-x-auto">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              By section
            </h2>
            <a href="/api/admin/stats/export" className="btn-ghost text-xs">
              Export CSV
            </a>
          </div>
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-400">
                <th className="py-2">Section</th>
                <th>Generated</th>
                <th>Solved</th>
                <th>Avg score</th>
              </tr>
            </thead>
            <tbody>
              {SECTIONS.map((s) => {
                const avg = stats.solved[s]?.avgScore ?? null;
                return (
                  <tr key={s} className="border-t border-slate-100">
                    <td className="py-2 font-medium text-slate-700">{s}</td>
                    <td>{stats.generated[s]?.count ?? 0}</td>
                    <td>{stats.solved[s]?.count ?? 0}</td>
                    <td>
                      {avg == null ? "-" : `${Math.round(avg * 100)}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="card p-5">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-3xl font-bold text-slate-900">{value}</p>
    </div>
  );
}

function today() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

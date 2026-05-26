"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const SECTIONS = ["VA", "RC", "DI", "LR", "QA"] as const;

interface Stats {
  totalUsers: number;
  recentRegistrations: { d: string; c: number }[];
  dau: { d: string; c: number }[];
  generated: Record<string, { count: number }>;
  solved: Record<string, { count: number; avgScore?: number | null }>;
  pool: Record<string, { count: number }>;
  kb: Record<string, { count: number }>;
}

export default function AdminClient({ username }: { username: string }) {
  const router = useRouter();
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

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  if (error)
    return (
      <main className="mx-auto max-w-4xl px-6 py-10">
        <p className="text-red-600">{error}</p>
      </main>
    );
  if (!stats)
    return <main className="mx-auto max-w-4xl px-6 py-10 text-slate-400">Loading...</main>;

  const maxDau = Math.max(1, ...stats.dau.map((d) => d.c));

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <span className="font-bold text-slate-900">CAT Mock Generator - Admin</span>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-slate-500">{username}</span>
            <button onClick={logout} className="btn-ghost">
              Log out
            </button>
          </div>
        </div>
      </header>

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
            Daily active visitors (last 14 days)
          </h2>
          <div className="mt-4 flex items-end gap-2" style={{ height: 120 }}>
            {stats.dau.length === 0 ? (
              <p className="text-sm text-slate-400">No activity yet.</p>
            ) : (
              stats.dau.map((d) => (
                <div key={d.d} className="flex flex-1 flex-col items-center">
                  <div
                    className="w-full rounded-t bg-brand/80"
                    style={{ height: `${(d.c / maxDau) * 100}%` }}
                    title={`${d.d}: ${d.c}`}
                  />
                  <span className="mt-1 text-[10px] text-slate-400">
                    {d.d.slice(5)}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="card p-6 overflow-x-auto">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            By section
          </h2>
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-400">
                <th className="py-2">Section</th>
                <th>Generated</th>
                <th>Solved</th>
                <th>Avg score</th>
                <th>Pool</th>
                <th>KB items</th>
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
                    <td>{stats.pool[s]?.count ?? 0}</td>
                    <td>{stats.kb[s]?.count ?? 0}</td>
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

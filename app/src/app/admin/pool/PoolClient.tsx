"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const SECTIONS = ["VA", "RC", "DI", "LR", "QA"] as const;

interface SectionPool {
  section: string;
  pooled: number;
  served: number;
  avg_quality: number | null;
  low_quality: number;
  generated_24h: number;
  generated_7d: number;
}
interface GenActivity {
  accepted: number;
  rejected: number;
  errored: number;
}
interface PoolResponse {
  sections: Record<string, SectionPool>;
  activity: Record<string, GenActivity>;
  poolTarget: number;
  minQuality: number;
}

function healthColor(pooled: number, target: number): string {
  const ratio = target > 0 ? pooled / target : 0;
  if (ratio >= 0.5) return "text-green-600";
  if (ratio >= 0.2) return "text-amber-600";
  return "text-red-600";
}

export default function PoolClient() {
  const [data, setData] = useState<PoolResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/pool");
        const d = await res.json();
        if (!res.ok) {
          setError(d.error || "Failed to load pool health.");
          return;
        }
        setData(d);
      } catch {
        setError("Network error.");
      }
    })();
  }, []);

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <span className="font-bold text-slate-900">CAT Mock Generator - Admin</span>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/admin" className="font-medium text-slate-500 hover:text-brand">Dashboard</Link>
            <Link href="/admin/questions" className="font-medium text-slate-500 hover:text-brand">Question sets</Link>
            <Link href="/admin/users" className="font-medium text-slate-500 hover:text-brand">Users</Link>
            <Link href="/admin/reports" className="font-medium text-slate-500 hover:text-brand">Reports</Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        <h1 className="text-2xl font-bold text-slate-900">Pool health</h1>
        <p className="mt-1 text-sm text-slate-500">
          How many ready-to-serve sets are sitting in the pool per section, and how healthy they are.
        </p>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        {!data ? (
          <p className="mt-6 text-sm text-slate-400">Loading...</p>
        ) : (
          <div className="card mt-6 overflow-x-auto p-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-400">
                  <th className="py-2">Section</th>
                  <th>Pooled</th>
                  <th>Served</th>
                  <th>Avg quality</th>
                  <th title={`Quality score below MIN_QUALITY (${data.minQuality})`}>Below bar</th>
                  <th>Generated 24h</th>
                  <th>Generated 7d</th>
                </tr>
              </thead>
              <tbody>
                {SECTIONS.map((s) => {
                  const row = data.sections[s];
                  return (
                    <tr key={s} className="border-t border-slate-100">
                      <td className="py-2 font-medium text-slate-700">{s}</td>
                      <td className={"font-semibold " + healthColor(row.pooled, data.poolTarget)}>
                        {row.pooled} / {data.poolTarget}
                      </td>
                      <td>{row.served}</td>
                      <td>{row.avg_quality == null ? "-" : row.avg_quality.toFixed(1)}</td>
                      <td className={row.low_quality > 0 ? "text-amber-600" : ""}>{row.low_quality}</td>
                      <td>{row.generated_24h}</td>
                      <td>{row.generated_7d}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-4 text-xs text-slate-400">
              &quot;Below bar&quot; sets scored under MIN_QUALITY ({data.minQuality}) but still got pooled anyway
              (a stale row from before the worker path was judge-gated too - see Generation activity below for
              the real accept/reject/error split going forward).
            </p>
          </div>
        )}

        {data && (
          <div className="card mt-6 overflow-x-auto p-6">
            <h2 className="text-lg font-semibold text-slate-900">Generation activity (last 24h)</h2>
            <p className="mt-1 text-sm text-slate-500">
              Every generation attempt, whether or not it ended up in the pool - from the worker&apos;s topup
              route and the hosted cron-topup, both judge-gated the same way.
            </p>
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-400">
                  <th className="py-2">Section</th>
                  <th>Accepted</th>
                  <th>Rejected</th>
                  <th>Errored</th>
                  <th>Accept rate</th>
                </tr>
              </thead>
              <tbody>
                {SECTIONS.map((s) => {
                  const a = data.activity[s] ?? { accepted: 0, rejected: 0, errored: 0 };
                  const attempts = a.accepted + a.rejected + a.errored;
                  const rate = attempts > 0 ? (a.accepted / attempts) * 100 : null;
                  return (
                    <tr key={s} className="border-t border-slate-100">
                      <td className="py-2 font-medium text-slate-700">{s}</td>
                      <td className="text-green-600">{a.accepted}</td>
                      <td className="text-amber-600">{a.rejected}</td>
                      <td className="text-red-600">{a.errored}</td>
                      <td>{rate == null ? "-" : `${rate.toFixed(0)}%`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}

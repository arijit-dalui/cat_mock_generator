"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AdminNavHeader from "../../components/AdminNavHeader";

interface ReportRow {
  id: number;
  attemptId: number | null;
  setId: number | null;
  questionId: string;
  section: string;
  promptSnapshot: string | null;
  reason: string | null;
  createdAt: string;
}

function fmtDate(s: string): string {
  const d = new Date(/T/.test(s) ? s : s.replace(" ", "T") + "Z");
  return isNaN(d.getTime()) ? s : d.toLocaleString();
}

export default function ReportsClient({ username }: { username: string }) {
  const [reports, setReports] = useState<ReportRow[] | null>(null);
  const [error, setError] = useState("");
  const [resolving, setResolving] = useState<number | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/admin/reports");
      const d = await res.json();
      if (!res.ok) {
        setError(d.error || "Failed to load reports.");
        return;
      }
      setReports(d.reports);
    } catch {
      setError("Network error.");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function resolve(id: number) {
    setResolving(id);
    try {
      await fetch(`/api/admin/reports/${id}`, { method: "POST" });
      setReports((rs) => (rs ? rs.filter((r) => r.id !== id) : rs));
    } finally {
      setResolving(null);
    }
  }

  return (
    <div className="app-shell min-h-screen">
      <AdminNavHeader active="/admin/reports" username={username} />

      <main className="mx-auto max-w-4xl px-6 py-8">
        <h1 className="text-2xl font-bold text-slate-900">Reported questions</h1>
        <p className="mt-1 text-sm text-slate-500">
          Flags from students on questions that looked wrong. Resolving here doesn&apos;t edit the question -
          fix it via Question sets first if it needs a fix, then resolve.
        </p>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        {!reports ? (
          <p className="mt-6 text-sm text-slate-400">Loading...</p>
        ) : reports.length === 0 ? (
          <p className="mt-6 text-sm text-slate-400">No open reports.</p>
        ) : (
          <ul className="mt-6 space-y-3">
            {reports.map((r) => (
              <li key={r.id} className="card p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-400">
                      {r.section} - {fmtDate(r.createdAt)}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm font-medium text-slate-900">
                      {r.promptSnapshot || `Question ${r.questionId} (prompt unavailable)`}
                    </p>
                    {r.reason && <p className="mt-2 text-sm text-slate-600">&quot;{r.reason}&quot;</p>}
                    {r.setId && (
                      <p className="mt-2 text-xs text-slate-400">
                        Set #{r.setId} - find it under{" "}
                        <Link href="/admin/questions" className="font-medium text-brand">
                          Question sets
                        </Link>{" "}
                        (filter by {r.section})
                      </p>
                    )}
                  </div>
                  <button onClick={() => resolve(r.id)} className="btn-ghost shrink-0" disabled={resolving === r.id}>
                    {resolving === r.id ? "..." : "Resolve"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import AdminNavHeader from "../../components/AdminNavHeader";

interface SectionAttempt {
  id: number;
  section: string;
  phase: string | null;
  score: number | null;
  total: number | null;
  raw_score: number | null;
  submitted: number;
}

interface MockRow {
  id: number;
  username: string;
  submitted: number;
  created_at: string;
  submitted_at: string | null;
  attempts: SectionAttempt[];
}

interface Pack {
  title: string;
  questions: number;
  sections: string[];
}

/** Admin view of full-length mocks: who sat what, per-section scores.
 * A mock is five pooled section sets (VA, RC, DI, LR, QA) bundled at
 * sit time - so this page shows sittings, while the underlying content
 * lives in Question sets / Pool health. */
export default function MocksClient({ username }: { username: string }) {
  const [mocks, setMocks] = useState<MockRow[] | null>(null);
  const [packs, setPacks] = useState<Pack[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/mocks");
        const d = await res.json();
        if (res.ok) {
          setMocks(d.mocks);
          setPacks(d.packs ?? []);
        } else setError(d.error || "Failed to load mocks.");
      } catch {
        setError("Network error.");
      }
    })();
  }, []);

  return (
    <div className="app-shell min-h-screen">
      <AdminNavHeader active="/admin/mocks" username={username} />
      <main className="mx-auto max-w-4xl px-6 py-8 space-y-6">
        <section className="card p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Full-length mocks
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            Each mock bundles five pooled section sets (VA, RC, DI, LR, QA) at sit time.
            Banked content lives in the pool and flows into every mock automatically.
          </p>
          {packs !== null && packs.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Banked full mocks in pool ({packs.length})
              </h3>
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-slate-400">
                    <th className="py-1">Mock</th>
                    <th>Questions</th>
                  </tr>
                </thead>
                <tbody>
                  {packs.map((p) => (
                    <tr key={p.title} className="border-t border-slate-100">
                      <td className="py-1 font-medium text-slate-700">{p.title}</td>
                      <td>{p.questions || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
          {mocks === null && !error && (
            <p className="mt-4 text-sm text-slate-400">Loading...</p>
          )}
          {mocks !== null && mocks.length === 0 && (
            <p className="mt-4 text-sm text-slate-400">
              No mocks sat yet. Users start one from the dashboard (Mock mode).
            </p>
          )}
          {mocks !== null && mocks.length > 0 && (
            <div className="mt-4 space-y-4">
              {mocks.map((m) => (
                <div key={m.id} className="rounded-lg border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="font-semibold text-slate-800">Mock #{m.id}</span>
                    <span className="text-slate-500">{m.username}</span>
                    <span
                      className={
                        "rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold " +
                        (m.submitted ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")
                      }
                    >
                      {m.submitted ? "submitted" : "in progress"}
                    </span>
                    <span className="ml-auto font-mono text-xs text-slate-400">
                      {m.submitted_at ?? m.created_at}
                    </span>
                  </div>
                  <table className="mt-3 w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase text-slate-400">
                        <th className="py-1">Section</th>
                        <th>Phase</th>
                        <th>Score</th>
                        <th>Raw</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {m.attempts.map((a) => (
                        <tr key={a.id} className="border-t border-slate-100">
                          <td className="py-1 font-medium text-slate-700">{a.section}</td>
                          <td className="text-slate-500">{a.phase ?? "-"}</td>
                          <td>
                            {a.score == null || a.total == null ? "-" : `${a.score}/${a.total}`}
                          </td>
                          <td>{a.raw_score == null ? "-" : a.raw_score}</td>
                          <td className="text-slate-500">{a.submitted ? "done" : "open"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

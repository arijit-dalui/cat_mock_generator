"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AdminNavHeader from "../../components/AdminNavHeader";

const SECTIONS = ["VA", "RC", "DI", "LR", "QA"] as const;
type Section = (typeof SECTIONS)[number];

interface SectionPool {
  section: string;
  pending: number;
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
interface InProgress {
  since: string;
  elapsedSec: number;
}
interface PoolResponse {
  sections: Record<string, SectionPool>;
  activity: Record<string, GenActivity>;
  inProgress: Record<string, InProgress | null>;
  poolTarget: number;
  minQuality: number;
}

function healthColor(pooled: number, target: number): string {
  const ratio = target > 0 ? pooled / target : 0;
  if (ratio >= 0.5) return "text-green-600";
  if (ratio >= 0.2) return "text-amber-600";
  return "text-red-600";
}

function fmtElapsed(sec: number): string {
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

export default function PoolClient({ username }: { username: string }) {
  const [data, setData] = useState<PoolResponse | null>(null);
  const [error, setError] = useState("");
  const [generating, setGenerating] = useState<Section | "batch" | null>(null);
  const [genMsg, setGenMsg] = useState("");
  const [autoRunning, setAutoRunning] = useState<boolean | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);

  async function load() {
    try {
      const [poolRes, autoRes] = await Promise.all([fetch("/api/admin/pool"), fetch("/api/admin/pool/auto")]);
      const d = await poolRes.json();
      if (!poolRes.ok) {
        setError(d.error || "Failed to load pool health.");
        return;
      }
      setError("");
      setData(d);
      const a = await autoRes.json();
      if (autoRes.ok) setAutoRunning(a.running);
    } catch {
      setError("Network error.");
    }
  }

  // Simple fixed-interval poll so "generating right now" and pool counts
  // stay live without a page refresh.
  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  async function toggleAuto() {
    setAutoBusy(true);
    try {
      const res = await fetch("/api/admin/pool/auto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: autoRunning ? "stop" : "start" }),
      });
      const d = await res.json();
      if (res.ok) setAutoRunning(d.running);
    } finally {
      setAutoBusy(false);
    }
  }

  function summarise(results: { section: Section; accepted: boolean; score: number; notes: string }[]) {
    const accepted = results.filter((r) => r.accepted).length;
    return `${accepted}/${results.length} accepted - ` + results.map((r) => `${r.section}: ${r.accepted ? "accepted" : r.notes}`).join(" · ");
  }

  async function generateNow(section: Section) {
    setGenerating(section);
    setGenMsg("");
    try {
      const res = await fetch("/api/admin/pool/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section, count: 1 }),
      });
      const d = await res.json();
      if (!res.ok) {
        setGenMsg(d.error || "Generation failed.");
        return;
      }
      const r = d.results?.[0];
      setGenMsg(
        r?.accepted
          ? `${section}: accepted (score ${r.score}) - now pending review.`
          : `${section}: ${r?.notes || "not accepted"} (score ${r?.score ?? 0}).`,
      );
      await load();
    } catch {
      setGenMsg("Network error.");
    } finally {
      setGenerating(null);
    }
  }

  /** "Generate multiple together": one attempt per section that's still
   * below target, fired concurrently in a single request. */
  async function generateBatch() {
    if (!data) return;
    const needed = SECTIONS.filter((s) => data.sections[s].pooled < data.poolTarget);
    if (needed.length === 0) {
      setGenMsg("Every section is already at its pool target.");
      return;
    }
    setGenerating("batch");
    setGenMsg("");
    try {
      const res = await fetch("/api/admin/pool/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections: needed }),
      });
      const d = await res.json();
      if (!res.ok) {
        setGenMsg(d.error || "Generation failed.");
        return;
      }
      setGenMsg(summarise(d.results));
      await load();
    } catch {
      setGenMsg("Network error.");
    } finally {
      setGenerating(null);
    }
  }

  return (
    <div className="app-shell min-h-screen">
      <AdminNavHeader active="/admin/pool" username={username} />

      <main className="mx-auto max-w-4xl px-6 py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="card-title text-2xl">Pool health</h1>
            <p className="mt-1 text-sm text-slate-500">
              How many ready-to-serve sets are sitting in the pool per section, and how healthy they are.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button onClick={generateBatch} disabled={!!generating || autoRunning === true} className="btn-ghost text-sm">
              {generating === "batch" ? "Generating..." : "Generate all needed now"}
            </button>
            <button
              onClick={toggleAuto}
              disabled={autoBusy || autoRunning === null}
              className={"btn text-sm " + (autoRunning ? "bg-red-600 text-white hover:bg-red-700" : "btn-primary")}
            >
              {autoRunning === null ? "..." : autoRunning ? "Stop auto-generation" : "Start auto-generation"}
            </button>
          </div>
        </div>
        {autoRunning && (
          <p className="mt-3 flex items-center gap-1.5 font-mono text-xs text-brand">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
            Auto-generation is running - it keeps every section topped up to target until you stop it.
          </p>
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        {genMsg && <p className="mt-3 text-sm text-slate-600">{genMsg}</p>}

        {!data ? (
          <p className="mt-6 text-sm text-slate-400">Loading...</p>
        ) : (
          <div className="card mt-6 overflow-x-auto p-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-400">
                  <th className="py-2">Section</th>
                  <th>Status</th>
                  <th title="Judge-accepted, awaiting admin approval - not servable yet">Pending review</th>
                  <th>Pooled</th>
                  <th>Served</th>
                  <th>Avg quality</th>
                  <th title={`Quality score below MIN_QUALITY (${data.minQuality})`}>Below bar</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {SECTIONS.map((s) => {
                  const row = data.sections[s];
                  const prog = data.inProgress[s];
                  return (
                    <tr key={s} className="border-t border-slate-100">
                      <td className="py-2 font-medium text-slate-700">{s}</td>
                      <td>
                        {prog ? (
                          <span className="inline-flex items-center gap-1.5 font-mono text-xs text-brand">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
                            Generating - {fmtElapsed(prog.elapsedSec)}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">idle</span>
                        )}
                      </td>
                      <td className={row.pending > 0 ? "font-semibold text-amber-600" : ""}>
                        {row.pending > 0 ? (
                          <Link href="/admin/questions" className="hover:underline">
                            {row.pending}
                          </Link>
                        ) : (
                          0
                        )}
                      </td>
                      <td className={"font-semibold " + healthColor(row.pooled, data.poolTarget)}>
                        {row.pooled} / {data.poolTarget}
                      </td>
                      <td>{row.served}</td>
                      <td>{row.avg_quality == null ? "-" : row.avg_quality.toFixed(1)}</td>
                      <td className={row.low_quality > 0 ? "text-amber-600" : ""}>{row.low_quality}</td>
                      <td>
                        <button
                          onClick={() => generateNow(s)}
                          disabled={!!generating || !!prog || autoRunning === true}
                          className="btn-ghost px-3 py-1 text-xs"
                        >
                          {generating === s ? "Generating..." : "Generate now"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {data && (
          <div className="card mt-6 overflow-x-auto p-6">
            <h2 className="card-title text-lg">Generation activity (last 24h)</h2>
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-400">
                  <th className="py-2">Section</th>
                  <th title="Passed the judge - sitting in Pending review or already approved">Accepted</th>
                  <th title="The automated judge scored it below the quality bar and discarded it - not a human action">Rejected by judge</th>
                  <th title="Generation crashed or timed out (LLM error, rate limit, etc.)">Errored</th>
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

"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const TABS = ["All", "VA", "RC", "DI", "LR", "QA"] as const;
type Tab = (typeof TABS)[number];
const OPT = ["A", "B", "C", "D"];

interface GenQuestion {
  id: string;
  type: string;
  prompt: string;
  options: string[];
  answer: number;
  explanations: string[];
  solution: string;
}
interface GenSubSet {
  id: string;
  contextLabel: string;
  context: string;
  source: string;
  questions: GenQuestion[];
}
interface Payload {
  section: string;
  kind: "questions" | "sets";
  items?: GenQuestion[];
  sets?: GenSubSet[];
  meta?: unknown;
}
interface SetRow {
  id: number;
  section: string;
  status: string;
  qualityScore: number | null;
  judgeNotes: string | null;
  createdAt: string;
  payload: Payload | null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Minimal markdown renderer for DI/LR contexts: GFM tables, bold, italic, `. */
function renderContext(src: string): string {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  const inlineFmt = (t: string) =>
    escapeHtml(t)
      .replace(/`([^`]+)`/g, '<code class="rounded bg-slate-100 px-1">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");

  while (i < lines.length) {
    const ln = lines[i];
    if (
      ln.trim().startsWith("|") &&
      i + 1 < lines.length &&
      /^\s*\|?\s*:?-+/.test(lines[i + 1])
    ) {
      const splitRow = (r: string) =>
        r.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
      const headers = splitRow(ln);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      out.push(
        `<div class="overflow-x-auto"><table class="my-2 w-full border-collapse text-sm"><thead><tr>` +
          headers
            .map(
              (h) =>
                `<th class="border border-slate-300 bg-slate-50 px-3 py-1.5 text-left font-semibold">${inlineFmt(h)}</th>`,
            )
            .join("") +
          `</tr></thead><tbody>` +
          rows
            .map(
              (r) =>
                `<tr>` +
                r.map((c) => `<td class="border border-slate-300 px-3 py-1.5">${inlineFmt(c)}</td>`).join("") +
                `</tr>`,
            )
            .join("") +
          `</tbody></table></div>`,
      );
      continue;
    }
    if (ln.trim() === "") {
      out.push("");
      i++;
      continue;
    }
    out.push(`<p class="my-1">${inlineFmt(ln)}</p>`);
    i++;
  }
  return out.join("\n");
}

const SECTION_COLORS: Record<string, string> = {
  VA: "bg-blue-100 text-blue-700",
  RC: "bg-green-100 text-green-700",
  DI: "bg-amber-100 text-amber-700",
  LR: "bg-purple-100 text-purple-700",
  QA: "bg-red-100 text-red-700",
};

function fmtDate(s: string): string {
  const d = new Date(/T/.test(s) ? s : s.replace(" ", "T") + "Z");
  return isNaN(d.getTime()) ? s : d.toLocaleString();
}

export default function QuestionsClient({ username }: { username: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("All");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<SetRow[]>([]);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (t: Tab, p: number) => {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({ page: String(p) });
      if (t !== "All") qs.set("section", t);
      const res = await fetch(`/api/admin/questions?${qs}`);
      const d = await res.json();
      if (!res.ok) {
        setError(d.error || "Failed to load.");
        setRows([]);
        setHasNext(false);
        return;
      }
      setRows(d.sets);
      setHasNext(d.hasNext);
    } catch {
      setError("Network error.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(tab, page);
  }, [tab, page, load]);

  function selectTab(t: Tab) {
    setTab(t);
    setPage(0);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="text-sm font-medium text-brand">
              &larr; Admin
            </Link>
            <span className="font-bold text-slate-900">Question sets</span>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-slate-500">{username}</span>
            <button onClick={logout} className="btn-ghost">
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => selectTab(t)}
              className={
                "rounded-lg px-4 py-2 text-sm font-medium transition-colors " +
                (tab === t
                  ? "bg-brand text-white"
                  : "bg-white text-slate-600 border border-slate-300 hover:bg-slate-50")
              }
            >
              {t}
            </button>
          ))}
        </div>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-6 space-y-4">
          {loading ? (
            <p className="text-sm text-slate-400">Loading...</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-400">No sets in this section yet.</p>
          ) : (
            rows.map((r) => (
              <SetCard key={r.id} row={r} onChanged={() => load(tab, page)} />
            ))
          )}
        </div>

        <div className="mt-8 flex items-center justify-between">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0 || loading}
            className="btn-ghost"
          >
            &larr; Previous
          </button>
          <span className="text-sm text-slate-500">Page {page + 1}</span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasNext || loading}
            className="btn-ghost"
          >
            Next &rarr;
          </button>
        </div>
      </main>
    </div>
  );
}

function SetCard({ row, onChanged }: { row: SetRow; onChanged: () => void }) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [draft, setDraft] = useState<Payload | null>(row.payload);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  function startEdit() {
    setDraft(structuredClone(row.payload));
    setMsg("");
    setMode("edit");
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch(`/api/admin/questions/${row.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: draft }),
      });
      const d = await res.json();
      if (!res.ok) {
        setMsg(d.error || "Save failed.");
        return;
      }
      setMode("view");
      onChanged();
    } catch {
      setMsg("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (
      !confirm(
        `Delete set #${row.id} (${row.section})?\n\nThis is permanent and also removes any user attempt history for this set.`,
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/questions/${row.id}`, { method: "DELETE" });
      const d = await res.json();
      if (!res.ok) {
        setMsg(d.error || "Delete failed.");
        return;
      }
      onChanged();
    } catch {
      setMsg("Network error.");
    } finally {
      setBusy(false);
    }
  }

  const subsets = draft?.kind === "sets" ? draft.sets ?? [] : [];
  const items = draft?.kind === "questions" ? draft.items ?? [] : [];

  function patchQuestion(updated: GenQuestion, subsetIdx: number | null, qIdx: number) {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      if (subsetIdx === null && next.items) next.items[qIdx] = updated;
      else if (subsetIdx !== null && next.sets) next.sets[subsetIdx].questions[qIdx] = updated;
      return next;
    });
  }

  function patchContext(value: string, subsetIdx: number) {
    setDraft((prev) => {
      if (!prev || !prev.sets) return prev;
      const next = structuredClone(prev);
      next.sets![subsetIdx].context = value;
      return next;
    });
  }

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span
            className={
              "rounded px-2 py-0.5 text-xs font-semibold " +
              (SECTION_COLORS[row.section] || "bg-slate-100 text-slate-700")
            }
          >
            {row.section}
          </span>
          <span className="font-medium text-slate-700">Set #{row.id}</span>
          <span className="text-slate-400">{fmtDate(row.createdAt)}</span>
          {row.qualityScore != null && (
            <span className="text-slate-400">· score {row.qualityScore}</span>
          )}
          <span className="text-slate-400">· {row.status}</span>
        </div>
        <div className="flex items-center gap-2">
          {mode === "view" ? (
            <>
              <button onClick={startEdit} className="btn-ghost" disabled={!row.payload}>
                Edit
              </button>
              <button
                onClick={remove}
                disabled={busy}
                className="btn rounded-lg border border-red-300 bg-white text-red-600 hover:bg-red-50"
              >
                Delete
              </button>
            </>
          ) : (
            <>
              <button onClick={save} disabled={busy} className="btn-primary">
                {busy ? "Saving..." : "Save"}
              </button>
              <button
                onClick={() => {
                  setMode("view");
                  setDraft(row.payload);
                  setMsg("");
                }}
                disabled={busy}
                className="btn-ghost"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>

      {row.judgeNotes && (
        <p className="mt-2 text-xs italic text-slate-400">Judge: {row.judgeNotes}</p>
      )}
      {msg && <p className="mt-2 text-sm text-red-600">{msg}</p>}

      {!draft && (
        <p className="mt-3 text-sm text-slate-400">
          Payload could not be parsed for this set.
        </p>
      )}

      <div className="mt-4 space-y-4">
        {draft?.kind === "questions" &&
          items.map((q, i) => (
            <QuestionBlock
              key={q.id || i}
              q={q}
              n={i + 1}
              editing={mode === "edit"}
              onChange={(u) => patchQuestion(u, null, i)}
            />
          ))}

        {draft?.kind === "sets" &&
          subsets.map((ss, si) => (
            <div key={ss.id || si} className="rounded-lg border border-slate-200 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand">
                {ss.contextLabel}
              </p>
              {mode === "edit" ? (
                <textarea
                  className="input mt-2 font-mono text-xs"
                  rows={6}
                  value={ss.context}
                  onChange={(e) => patchContext(e.target.value, si)}
                />
              ) : (
                <div
                  className="prose-cat mt-2 text-sm leading-relaxed text-slate-700"
                  dangerouslySetInnerHTML={{ __html: renderContext(ss.context) }}
                />
              )}
              {ss.source && (
                <p className="mt-2 text-xs text-slate-400">Source: {ss.source}</p>
              )}
              <div className="mt-3 space-y-4">
                {ss.questions.map((q, qi) => (
                  <QuestionBlock
                    key={q.id || qi}
                    q={q}
                    n={qi + 1}
                    editing={mode === "edit"}
                    onChange={(u) => patchQuestion(u, si, qi)}
                  />
                ))}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

function QuestionBlock({
  q,
  n,
  editing,
  onChange,
}: {
  q: GenQuestion;
  n: number;
  editing: boolean;
  onChange: (q: GenQuestion) => void;
}) {
  function set<K extends keyof GenQuestion>(key: K, value: GenQuestion[K]) {
    onChange({ ...q, [key]: value });
  }
  function setOption(i: number, value: string) {
    const options = [...q.options];
    options[i] = value;
    onChange({ ...q, options });
  }
  function setExplanation(i: number, value: string) {
    const explanations = [...q.explanations];
    explanations[i] = value;
    onChange({ ...q, explanations });
  }

  if (!editing) {
    return (
      <div className="rounded-lg bg-slate-50 p-4">
        <p className="font-medium text-slate-900">
          <span className="text-slate-400">Q{n}.</span>{" "}
          <span className="whitespace-pre-wrap">{q.prompt}</span>
        </p>
        <ul className="mt-2 space-y-1 text-sm">
          {q.options.map((opt, i) => (
            <li
              key={i}
              className={
                "rounded px-2 py-1 " +
                (i === q.answer ? "bg-green-100 font-medium text-green-800" : "text-slate-600")
              }
            >
              <span className="font-semibold">{OPT[i]}.</span> {opt}
              {q.explanations?.[i] && (
                <span className="ml-1 text-xs text-slate-500">— {q.explanations[i]}</span>
              )}
            </li>
          ))}
        </ul>
        {q.solution && (
          <p className="mt-2 text-xs text-slate-500">
            <span className="font-semibold">Solution:</span>{" "}
            <span className="whitespace-pre-wrap">{q.solution}</span>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <label className="label">Q{n} prompt</label>
      <textarea
        className="input"
        rows={3}
        value={q.prompt}
        onChange={(e) => set("prompt", e.target.value)}
      />
      <div className="mt-3 space-y-2">
        {q.options.map((opt, i) => (
          <div key={i} className="flex items-start gap-2">
            <button
              type="button"
              onClick={() => set("answer", i)}
              title="Mark as correct answer"
              className={
                "mt-1 h-6 w-6 shrink-0 rounded-full border text-xs font-semibold " +
                (q.answer === i
                  ? "border-green-500 bg-green-500 text-white"
                  : "border-slate-300 bg-white text-slate-500 hover:border-green-400")
              }
            >
              {OPT[i]}
            </button>
            <div className="flex-1">
              <input
                className="input"
                value={opt}
                onChange={(e) => setOption(i, e.target.value)}
                placeholder={`Option ${OPT[i]}`}
              />
              <textarea
                className="input mt-1 text-xs"
                rows={2}
                value={q.explanations?.[i] ?? ""}
                onChange={(e) => setExplanation(i, e.target.value)}
                placeholder={`Why ${OPT[i]} is right/wrong`}
              />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-1 text-xs text-slate-400">
        Correct answer: <span className="font-semibold">{OPT[q.answer] ?? "?"}</span> (click a
        letter to change)
      </p>
      <label className="label mt-3">Solution</label>
      <textarea
        className="input"
        rows={3}
        value={q.solution}
        onChange={(e) => set("solution", e.target.value)}
      />
    </div>
  );
}

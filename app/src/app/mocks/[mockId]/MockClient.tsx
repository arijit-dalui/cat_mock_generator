"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { EXAM_COLORS, formatClock, renderContext, withInstructionFallback } from "@/lib/examUi";
import { SECTION_DURATION_MIN } from "@/lib/exam";
import Calculator from "@/app/components/Calculator";

interface GenQuestion {
  id: string;
  type: string;
  format?: "mcq" | "tita";
  prompt: string;
  options: string[];
  answer: number | string;
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
interface GeneratedSet {
  section: string;
  kind: "questions" | "sets";
  items?: GenQuestion[];
  sets?: GenSubSet[];
}
interface MockAttempt {
  attemptId: number;
  section: string;
  phase: "VARC" | "DILR" | "QA";
  submitted: boolean;
  score: number | null;
  total: number | null;
  rawScore: number | null;
  answers: Record<string, unknown>;
  set: GeneratedSet | null;
}
interface MockData {
  mock: { id: number; submitted: boolean; createdAt: string };
  attempts: MockAttempt[];
}
interface NavItem {
  attemptId: number;
  section: string;
  q: GenQuestion;
  contextLabel?: string;
  context?: string;
  source?: string;
}

const PHASES: { phase: "VARC" | "DILR" | "QA"; label: string; hasCalc: boolean }[] = [
  { phase: "VARC", label: "Verbal Ability & Reading Comprehension", hasCalc: false },
  { phase: "DILR", label: "Data Interpretation & Logical Reasoning", hasCalc: true },
  { phase: "QA", label: "Quantitative Ability", hasCalc: true },
];

const MARKED_KEY = "__marked";
const DEADLINE_KEY = "__deadline";
const DEV_MODE = process.env.NODE_ENV !== "production";

function allQuestions(set: GeneratedSet): GenQuestion[] {
  return set.kind === "questions" ? set.items ?? [] : (set.sets ?? []).flatMap((s) => s.questions);
}

/** Composite key so VA and RC questions (or DI and LR) can share one
 * answers map without id collisions - the underlying attempt is still
 * whichever one actually owns that question. */
function ck(attemptId: number, qid: string): string {
  return `${attemptId}::${qid}`;
}

function buildNav(attempts: MockAttempt[]): NavItem[] {
  const nav: NavItem[] = [];
  for (const a of attempts) {
    if (!a.set) continue;
    if (a.set.kind === "questions") {
      for (const q of a.set.items ?? []) nav.push({ attemptId: a.attemptId, section: a.section, q });
    } else {
      for (const ss of a.set.sets ?? []) {
        for (const q of ss.questions) {
          nav.push({ attemptId: a.attemptId, section: a.section, q, contextLabel: ss.contextLabel, context: ss.context, source: ss.source });
        }
      }
    }
  }
  return nav;
}

export default function MockClient({ mockId }: { mockId: string }) {
  const [data, setData] = useState<MockData | null>(null);
  const [error, setError] = useState("");
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [started, setStarted] = useState(false);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [visited, setVisited] = useState<Set<string>>(new Set());
  const [current, setCurrent] = useState(0);
  const [showCalc, setShowCalc] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const timeUpHandled = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/mocks/${mockId}`);
        const d = await res.json();
        if (!res.ok) {
          setError(d.error || "Could not load this mock.");
          return;
        }
        setData(d);
        if (d.mock.submitted) {
          setFinished(true);
          return;
        }
        // Resume: find the first phase that isn't fully submitted yet, and
        // restore that phase's saved deadline/answers/marks if present.
        const phaseAttempts = (p: string) => (d.attempts as MockAttempt[]).filter((a) => a.phase === p);
        const idx = PHASES.findIndex((p) => phaseAttempts(p.phase).some((a) => !a.submitted));
        const resumeIdx = idx === -1 ? PHASES.length - 1 : idx;
        setPhaseIdx(resumeIdx);
        const atts = phaseAttempts(PHASES[resumeIdx].phase);
        let savedDeadline: number | null = null;
        const restoredAnswers: Record<string, unknown> = {};
        const restoredMarked: string[] = [];
        for (const a of atts) {
          const draft = { ...(a.answers || {}) } as Record<string, unknown>;
          if (typeof draft[DEADLINE_KEY] === "number") savedDeadline = draft[DEADLINE_KEY] as number;
          if (Array.isArray(draft[MARKED_KEY])) restoredMarked.push(...(draft[MARKED_KEY] as string[]));
          delete draft[DEADLINE_KEY];
          delete draft[MARKED_KEY];
          for (const [qid, val] of Object.entries(draft)) restoredAnswers[ck(a.attemptId, qid)] = val;
        }
        setAnswers(restoredAnswers);
        setMarked(new Set(restoredMarked));
        if (savedDeadline) {
          setDeadline(savedDeadline);
          setStarted(true);
        }
      } catch {
        setError("Network error.");
      }
    })();
  }, [mockId]);

  const phase = PHASES[phaseIdx];
  const phaseAttempts = useMemo(
    () => (data ? data.attempts.filter((a) => a.phase === phase.phase) : []),
    [data, phase],
  );
  const nav = useMemo(() => buildNav(phaseAttempts), [phaseAttempts]);

  useEffect(() => {
    if (!started || nav.length === 0) return;
    const id = nav[current]?.q.id;
    const aid = nav[current]?.attemptId;
    if (!id) return;
    const key = ck(aid, id);
    setVisited((v) => (v.has(key) ? v : new Set(v).add(key)));
  }, [current, nav, started]);

  const saveDraft = useCallback(
    (nextAnswers: Record<string, unknown>, nextMarked: Set<string>, nextDeadline: number | null) => {
      for (const a of phaseAttempts) {
        const draft: Record<string, unknown> = { [DEADLINE_KEY]: nextDeadline, [MARKED_KEY]: [] as string[] };
        const prefix = `${a.attemptId}::`;
        for (const [key, val] of Object.entries(nextAnswers)) {
          if (key.startsWith(prefix)) draft[key.slice(prefix.length)] = val;
        }
        (draft[MARKED_KEY] as string[]) = Array.from(nextMarked)
          .filter((k) => k.startsWith(prefix))
          .map((k) => k.slice(prefix.length));
        fetch(`/api/attempts/${a.attemptId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answers: draft }),
        }).catch(() => {});
      }
    },
    [phaseAttempts],
  );

  const submitPhase = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      for (const a of phaseAttempts) {
        const prefix = `${a.attemptId}::`;
        const attemptAnswers: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(answers)) {
          if (key.startsWith(prefix)) attemptAnswers[key.slice(prefix.length)] = val;
        }
        const res = await fetch(`/api/attempts/${a.attemptId}/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answers: attemptAnswers }),
        });
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d.error || "Could not submit a section.");
        }
      }
      if (phaseIdx < PHASES.length - 1) {
        setPhaseIdx((i) => i + 1);
        setCurrent(0);
        setAnswers({});
        setMarked(new Set());
        setVisited(new Set());
        setDeadline(null);
        setStarted(false);
        timeUpHandled.current = false;
        // Refresh mock data so the next phase's attempts/sets are current.
        const res = await fetch(`/api/mocks/${mockId}`);
        const d = await res.json();
        if (res.ok) setData(d);
      } else {
        const res = await fetch(`/api/mocks/${mockId}`, { method: "POST" });
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d.error || "Could not finalize the mock.");
        }
        setFinished(true);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit this section.");
    } finally {
      setBusy(false);
    }
  }, [phaseAttempts, answers, phaseIdx, mockId]);

  // Full-mock timer always force-submits at zero, matching real CAT - no
  // extra-time choice like sectional practice offers.
  useEffect(() => {
    if (!started || deadline === null || finished) return;
    const tick = () => {
      const left = deadline - Date.now();
      setRemainingMs(left);
      if (left <= 0 && !timeUpHandled.current) {
        timeUpHandled.current = true;
        submitPhase();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [started, deadline, finished, submitPhase]);

  useEffect(() => {
    if (!started || deadline === null || finished) return;
    const id = setTimeout(() => saveDraft(answers, marked, deadline), 1200);
    return () => clearTimeout(id);
  }, [answers, marked, deadline, started, finished, saveDraft]);

  function startPhase() {
    const d = Date.now() + SECTION_DURATION_MIN * 60_000;
    setDeadline(d);
    setStarted(true);
    saveDraft(answers, marked, d);
    if (!DEV_MODE) document.documentElement.requestFullscreen?.().catch(() => {});
  }

  const pick = useCallback((attemptId: number, qid: string, idx: number) => {
    setAnswers((a) => ({ ...a, [ck(attemptId, qid)]: idx }));
  }, []);
  const typeAnswer = useCallback((attemptId: number, qid: string, value: string) => {
    setAnswers((a) => ({ ...a, [ck(attemptId, qid)]: value }));
  }, []);
  const toggleMark = useCallback((key: string) => {
    setMarked((m) => {
      const next = new Set(m);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const clearResponse = useCallback((key: string) => {
    setAnswers((a) => {
      const next = { ...a };
      delete next[key];
      return next;
    });
  }, []);

  if (error && !data)
    return (
      <main style={{ maxWidth: 640, margin: "40px auto", padding: 20 }}>
        <p style={{ color: EXAM_COLORS.notAnswered }}>{error}</p>
        <Link href="/dashboard" className="btn-ghost mt-4">Back to dashboard</Link>
      </main>
    );
  if (!data) return <main style={{ padding: 40, color: EXAM_COLORS.textMuted }}>Loading...</main>;

  // ---- Final combined result --------------------------------------------
  if (finished) {
    const totals = data.attempts.reduce(
      (acc, a) => ({
        rawScore: acc.rawScore + (a.rawScore ?? 0),
        correct: acc.correct + (a.score ?? 0),
        total: acc.total + (a.total ?? 0),
      }),
      { rawScore: 0, correct: 0, total: 0 },
    );
    return (
      <div style={{ minHeight: "100vh", background: EXAM_COLORS.panelBg, color: EXAM_COLORS.text, colorScheme: "light" }}>
        <div style={{ background: EXAM_COLORS.headerBg, color: EXAM_COLORS.headerText, padding: "10px 20px", display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontWeight: 600 }}>Full Mock - Result</span>
          <Link href="/dashboard" style={{ color: EXAM_COLORS.headerText, textDecoration: "none" }}>Dashboard</Link>
        </div>
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "24px 20px 60px" }}>
          <div style={{ borderRadius: 8, padding: 24, background: EXAM_COLORS.tabActiveBg, color: "#fff" }}>
            <p style={{ fontSize: 24, fontWeight: 700 }}>{totals.rawScore} marks</p>
            <p style={{ fontSize: 14, opacity: 0.85 }}>
              {totals.correct} correct out of {totals.total}
              {totals.total > 0 && ` (${Math.round((totals.correct / totals.total) * 100)}%)`}
            </p>
          </div>
          <div style={{ marginTop: 20 }}>
            {PHASES.map((p) => (
              <div key={p.phase} style={{ marginBottom: 16 }}>
                <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>{p.phase} - {p.label}</p>
                {data.attempts.filter((a) => a.phase === p.phase).map((a) => (
                  <div key={a.attemptId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", border: `1px solid ${EXAM_COLORS.border}`, borderRadius: 6, marginBottom: 6 }}>
                    <span style={{ fontSize: 13 }}>{a.section}: {a.score}/{a.total} correct - {a.rawScore} marks</span>
                    <Link href={`/practice/${a.attemptId}`} style={{ fontSize: 12, color: EXAM_COLORS.primary }}>View breakdown</Link>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <Link href="/dashboard" className="btn-ghost mt-4" style={{ display: "inline-block" }}>Back to dashboard</Link>
        </div>
      </div>
    );
  }

  // ---- Instructions / start-phase gate -----------------------------------
  if (!started) {
    const isFirstPhase = phaseIdx === 0;
    return (
      <div style={{ minHeight: "100vh", background: EXAM_COLORS.panelBg, color: EXAM_COLORS.text, colorScheme: "light" }}>
        <div style={{ background: EXAM_COLORS.headerBg, color: EXAM_COLORS.headerText, padding: "10px 20px", fontWeight: 600 }}>
          Full Mock - {phase.phase} Instructions
        </div>
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "24px 20px 90px" }}>
          <p style={{ fontWeight: 700, fontSize: 18 }}>{phase.phase} - {phase.label}</p>
          <p style={{ marginTop: 8, fontSize: 20, fontWeight: 700 }}>{formatClock(SECTION_DURATION_MIN * 60_000)}</p>
          <p style={{ fontSize: 12, color: EXAM_COLORS.textMuted, marginBottom: 20 }}>Section duration</p>
          {isFirstPhase && (
            <p style={{ fontSize: 14, marginBottom: 16 }}>
              This is a full mock: three sections back to back (VARC, then DILR, then QA), 40 minutes each,
              120 minutes total. Once a section's time is up, it auto-submits and the next section starts -
              you cannot go back to a finished section.
            </p>
          )}
          <ul style={{ paddingLeft: 20, lineHeight: 1.7, fontSize: 14 }}>
            <li>+3 for a correct MCQ answer, -1 for a wrong one, 0 for unattempted. TITA questions never lose marks.</li>
            <li>{phase.hasCalc ? "An on-screen calculator is available for this section." : "No calculator for VARC - there's nothing to compute."}</li>
            <li>Your answers save automatically as you work.</li>
          </ul>
        </div>
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#fff", borderTop: `1px solid ${EXAM_COLORS.border}`, padding: "12px 20px", display: "flex", justifyContent: "flex-end" }}>
          <button onClick={startPhase} style={{ background: EXAM_COLORS.primary, color: "#fff", border: "none", borderRadius: 4, padding: "10px 28px", fontWeight: 600, cursor: "pointer" }}>
            Start {phase.phase}
          </button>
        </div>
      </div>
    );
  }

  // ---- Live phase ---------------------------------------------------------
  const item = nav[current];
  if (!item) {
    return <main style={{ padding: 40, color: EXAM_COLORS.textMuted }}>This section could not be generated.</main>;
  }
  const total = nav.length;
  const currentKey = ck(item.attemptId, item.q.id);
  const answeredCount = nav.filter((it) => {
    const k = ck(it.attemptId, it.q.id);
    return answers[k] !== undefined && String(answers[k]).trim() !== "";
  }).length;
  const unanswered = total - answeredCount;
  const lowTime = remainingMs !== null && remainingMs < 5 * 60_000;
  const isTita = item.q.format === "tita";
  const chosen = answers[currentKey] === undefined ? undefined : Number(answers[currentKey]);
  const typedAnswer = String(answers[currentKey] ?? "");
  const isMarked = marked.has(currentKey);
  const isAnswered = answers[currentKey] !== undefined && String(answers[currentKey]).trim() !== "";

  function statusOf(key: string): "answered" | "marked" | "answered-marked" | "visited" | "unvisited" {
    const answered = answers[key] !== undefined && String(answers[key]).trim() !== "";
    const isMarkedQ = marked.has(key);
    if (answered && isMarkedQ) return "answered-marked";
    if (isMarkedQ) return "marked";
    if (answered) return "answered";
    if (visited.has(key)) return "visited";
    return "unvisited";
  }
  const paletteStyle: Record<string, { bg: string; color: string; border: string }> = {
    unvisited: { bg: EXAM_COLORS.notVisited, color: EXAM_COLORS.notVisitedText, border: EXAM_COLORS.notVisited },
    visited: { bg: EXAM_COLORS.notAnswered, color: "#fff", border: EXAM_COLORS.notAnswered },
    answered: { bg: EXAM_COLORS.answered, color: "#fff", border: EXAM_COLORS.answered },
    marked: { bg: EXAM_COLORS.marked, color: "#fff", border: EXAM_COLORS.marked },
    "answered-marked": { bg: EXAM_COLORS.marked, color: "#fff", border: EXAM_COLORS.answered },
  };

  function goTo(idx: number) {
    setCurrent(Math.min(Math.max(idx, 0), total - 1));
  }
  function saveAndNext() {
    if (current < total - 1) goTo(current + 1);
  }
  function markAndNext() {
    toggleMark(currentKey);
    if (current < total - 1) goTo(current + 1);
  }

  return (
    <div style={{ minHeight: "100vh", background: EXAM_COLORS.panelBg, color: EXAM_COLORS.text, colorScheme: "light", userSelect: "none" }}>
      <div style={{ background: EXAM_COLORS.headerBg, color: EXAM_COLORS.headerText, padding: "10px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
        <span style={{ fontWeight: 600 }}>Full Mock - {phase.phase} ({item.section})</span>
        <div style={{ display: "flex", gap: 16 }}>
          {phase.hasCalc && (
            <button onClick={() => setShowCalc((v) => !v)} style={{ background: "none", border: "none", color: EXAM_COLORS.headerText, cursor: "pointer", fontSize: 13 }}>
              Calculator
            </button>
          )}
          <Link href="/dashboard" style={{ color: EXAM_COLORS.headerText, textDecoration: "none" }}>Exit</Link>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "baseline", gap: 16, padding: "8px 20px 4px", borderBottom: `1px solid ${EXAM_COLORS.border}` }}>
        <span style={{ fontSize: 12, color: EXAM_COLORS.textMuted }}>Marks for correct answer 3 | Negative Marks {isTita ? 0 : 1}</span>
        <span style={{ fontWeight: 700, fontSize: 14, color: lowTime ? EXAM_COLORS.notAnswered : EXAM_COLORS.text }}>
          Time Left : {remainingMs === null ? formatClock(SECTION_DURATION_MIN * 60_000) : formatClock(remainingMs)}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "stretch" }}>
        {item.context && (
          <div style={{ flex: 1, borderRight: `1px solid ${EXAM_COLORS.border}`, padding: 16, height: "calc(100vh - 156px)", overflowY: "auto" }}>
            <p style={{ fontWeight: 700, marginBottom: 8, fontSize: 14 }}>{item.contextLabel}</p>
            <div style={{ fontSize: 14, lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: renderContext(item.context) }} />
            {item.source && <p style={{ marginTop: 8, fontSize: 11, color: EXAM_COLORS.textMuted }}>Source: {item.source}</p>}
          </div>
        )}

        <div style={{ flex: 1, borderRight: `1px solid ${EXAM_COLORS.border}`, padding: 16, height: "calc(100vh - 156px)", overflowY: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <p style={{ fontWeight: 700, fontSize: 14 }}>Question No. {current + 1} <span style={{ fontWeight: 400, color: EXAM_COLORS.textMuted }}>({item.section})</span></p>
            <button
              onClick={() => toggleMark(currentKey)}
              style={{ fontSize: 11, fontWeight: 600, border: `1px solid ${isMarked ? EXAM_COLORS.marked : EXAM_COLORS.border}`, background: isMarked ? EXAM_COLORS.markedBg : "#fff", color: isMarked ? EXAM_COLORS.marked : EXAM_COLORS.textMuted, borderRadius: 4, padding: "4px 10px", cursor: "pointer" }}
            >
              {isMarked ? "Marked" : "Mark for Review"}
            </button>
          </div>
          <p style={{ fontSize: 14, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{withInstructionFallback(item.q)}</p>

          {isTita ? (
            <div style={{ marginTop: 16, maxWidth: 260 }}>
              <input
                value={typedAnswer}
                onChange={(e) => typeAnswer(item.attemptId, item.q.id, e.target.value)}
                inputMode="decimal"
                placeholder="Type your answer"
                style={{ width: "100%", border: `1px solid ${EXAM_COLORS.border}`, borderRadius: 4, padding: "8px 10px", fontSize: 14, fontFamily: "monospace" }}
              />
            </div>
          ) : (
            <div style={{ marginTop: 16 }}>
              {item.q.options.map((opt, i) => (
                <label key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", fontSize: 14, cursor: "pointer" }}>
                  <input type="radio" checked={chosen === i} onChange={() => pick(item.attemptId, item.q.id, i)} style={{ marginTop: 3 }} />
                  <span>{opt}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div style={{ width: 300, flexShrink: 0, background: EXAM_COLORS.paletteBg, padding: 16, height: "calc(100vh - 156px)", overflowY: "auto" }}>
          <p style={{ fontSize: 12, color: EXAM_COLORS.textMuted, marginBottom: 8 }}>{answeredCount} answered - {unanswered} remaining</p>
          <div style={{ background: "#fff", border: `1px solid ${EXAM_COLORS.border}`, borderRadius: 4, padding: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
              {nav.map((it, idx) => {
                const key = ck(it.attemptId, it.q.id);
                const st = paletteStyle[statusOf(key)];
                return (
                  <button
                    key={key}
                    onClick={() => goTo(idx)}
                    style={{ width: 32, height: 32, borderRadius: 4, border: idx === current ? `2px solid ${EXAM_COLORS.text}` : `1px solid ${st.border}`, background: st.bg, color: st.color, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>
          </div>
          <button onClick={() => setConfirmOpen(true)} disabled={busy} style={{ marginTop: 16, width: "100%", background: EXAM_COLORS.primary, color: "#fff", border: "none", borderRadius: 4, padding: "10px 0", fontWeight: 600, cursor: "pointer" }}>
            {busy ? "Submitting..." : phaseIdx < PHASES.length - 1 ? "Submit & continue" : "Submit mock"}
          </button>
          {error && <p style={{ marginTop: 8, fontSize: 12, color: EXAM_COLORS.notAnswered }}>{error}</p>}
        </div>
      </div>

      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, borderTop: `1px solid ${EXAM_COLORS.border}`, background: "#fff", padding: "10px 20px", display: "flex", justifyContent: "space-between", zIndex: 20 }}>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={markAndNext} style={{ border: `1px solid ${EXAM_COLORS.border}`, background: "#fff", borderRadius: 4, padding: "8px 14px", fontSize: 13, cursor: "pointer" }}>
            Mark For Review &amp; Next
          </button>
          <button onClick={() => clearResponse(currentKey)} disabled={!isAnswered} style={{ border: `1px solid ${EXAM_COLORS.border}`, background: "#fff", borderRadius: 4, padding: "8px 14px", fontSize: 13, cursor: isAnswered ? "pointer" : "not-allowed", opacity: isAnswered ? 1 : 0.5 }}>
            Clear Response
          </button>
        </div>
        {current < total - 1 ? (
          <button onClick={saveAndNext} style={{ background: EXAM_COLORS.primary, color: "#fff", border: "none", borderRadius: 4, padding: "8px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            Save and Next
          </button>
        ) : (
          <button onClick={() => setConfirmOpen(true)} disabled={busy} style={{ background: EXAM_COLORS.primary, color: "#fff", border: "none", borderRadius: 4, padding: "8px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            {phaseIdx < PHASES.length - 1 ? "Submit & Continue" : "Submit Mock"}
          </button>
        )}
      </div>

      {showCalc && phase.hasCalc && <Calculator onClose={() => setShowCalc(false)} />}

      {confirmOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 30 }}>
          <div style={{ background: "#fff", borderRadius: 8, padding: 24, maxWidth: 380, width: "90%" }}>
            <p style={{ fontWeight: 700, marginBottom: 8 }}>
              {phaseIdx < PHASES.length - 1 ? `Submit ${phase.phase} and continue?` : "Submit the full mock?"}
            </p>
            <p style={{ fontSize: 13, color: EXAM_COLORS.textMuted, marginBottom: 16 }}>
              {unanswered > 0
                ? `${unanswered} question${unanswered === 1 ? "" : "s"} left unanswered in this section. `
                : "All questions in this section are answered. "}
              You can&apos;t change answers in {phase.phase} after this.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setConfirmOpen(false)} style={{ border: `1px solid ${EXAM_COLORS.border}`, background: "#fff", borderRadius: 4, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>
                Keep working
              </button>
              <button
                onClick={() => {
                  setConfirmOpen(false);
                  submitPhase();
                }}
                disabled={busy}
                style={{ background: EXAM_COLORS.primary, color: "#fff", border: "none", borderRadius: 4, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

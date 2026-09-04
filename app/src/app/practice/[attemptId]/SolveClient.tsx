"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { SECTION_DURATION_MIN } from "@/lib/exam";
import { scoreSet, type ScoreResult } from "@/lib/practice";
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
interface AttemptData {
  attempt: {
    id: number;
    section: string;
    submitted: boolean;
    score: number | null;
    total: number | null;
    answers: Record<string, unknown>;
    createdAt: string;
  };
  set: GeneratedSet;
}

/** One navigable slot in the single-question solving view. RC/DI/LR
 * questions carry the passage/context they belong to; VA/QA carry none. */
interface NavItem {
  q: GenQuestion;
  contextLabel?: string;
  context?: string;
  source?: string;
}

/** Reserved keys that ride inside the `answers` JSON blob alongside real
 * question ids, so autosave/resume needs no extra DB columns. No generated
 * question id collides with these. */
const MARKED_KEY = "__marked";
const DEADLINE_KEY = "__deadline";
const STRICT_KEY = "__strict";

// Anti-cheat (fullscreen lock, tab-switch detection, forced time-up) is
// only ever a nuisance in local dev, where switching to a terminal or these
// devtools is normal workflow, not cheating. Next.js inlines NODE_ENV at
// build time, so this is a real dead-code branch in production, not a
// runtime toggle a candidate could flip.
const DEV_MODE = process.env.NODE_ENV !== "production";

const SECTION_FULL_NAMES: Record<string, string> = {
  VA: "Verbal Ability",
  RC: "Reading Comprehension",
  DI: "Data Interpretation",
  LR: "Logical Reasoning",
  QA: "Quantitative Ability",
};

// The live exam screen intentionally renders as a fixed light theme,
// independent of the app's dark-mode toggle - real CAT test-day software
// has no dark mode, and matching it builds the same visual muscle memory.
const EXAM_COLORS = {
  headerBg: "#1c2b3a",
  headerText: "#e8edf3",
  tabBarBg: "#eef1f5",
  tabActiveBg: "#3f6db0",
  border: "#c7d0da",
  panelBg: "#ffffff",
  paletteBg: "#dce8f5",
  text: "#1a1a1a",
  textMuted: "#5a6472",
  answered: "#3fa84a",
  answeredBg: "#e7f5e9",
  notAnswered: "#d9534f",
  notAnsweredBg: "#fbeceb",
  marked: "#7c4dbe",
  markedBg: "#ece3f7",
  notVisited: "#e2e6ea",
  notVisitedText: "#5a6472",
  primary: "#3f6db0",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Minimal markdown renderer for DI/LR contexts: GFM tables, bold, italic, ` */
function renderContext(src: string): string {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  const inlineFmt = (t: string) =>
    escapeHtml(t)
      .replace(/`([^`]+)`/g, '<code style="background:#f1f3f5;border-radius:3px;padding:0 4px;">$1</code>')
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
        r
          .replace(/^\s*\|/, "")
          .replace(/\|\s*$/, "")
          .split("|")
          .map((c) => c.trim());
      const headers = splitRow(ln);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      out.push(
        `<div style="overflow-x:auto"><table style="margin:8px 0;width:100%;border-collapse:collapse;font-size:13px;">` +
          `<thead><tr>` +
          headers
            .map(
              (h) =>
                `<th style="border:1px solid #c7d0da;background:#f1f3f5;padding:6px 10px;text-align:left;font-weight:600;">${inlineFmt(h)}</th>`,
            )
            .join("") +
          `</tr></thead><tbody>` +
          rows
            .map(
              (r) =>
                `<tr>` +
                r.map((c) => `<td style="border:1px solid #c7d0da;padding:6px 10px;">${inlineFmt(c)}</td>`).join("") +
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
    out.push(`<p style="margin:4px 0;">${inlineFmt(ln)}</p>`);
    i++;
  }
  return out.join("\n");
}

/** Some LLM generations forget to include the directional sentence
 * (e.g. odd-one-out prompts that show 5 numbered sentences but no
 * "identify the misfit" instruction). Prepend a fallback when we
 * detect that pattern. */
function withInstructionFallback(q: GenQuestion): string {
  const p = q.prompt;
  if (
    q.type === "para_jumble" &&
    /^\s*1\.\s/.test(p) &&
    !/arrange|order|sequence/i.test(p.slice(0, 80))
  ) {
    return "Arrange the following sentences in the correct logical order.\n" + p;
  }
  if (
    q.type === "odd_one_out" &&
    /\b1\.\s/.test(p) &&
    !/misfit|odd one|does not fit|not belong/i.test(p)
  ) {
    return (
      "Five sentences below relate to the same theme. Identify the ONE sentence that does not fit with the others.\n" +
      p
    );
  }
  if (
    q.type === "para_completion" &&
    !/_____|complete the|best completes|fill in the blank/i.test(p)
  ) {
    return "Choose the option that best completes the paragraph below.\n" + p;
  }
  if (q.type === "summary" && !/summari[sz]e|main idea|best capture/i.test(p)) {
    return p + "\nWhich of the following best summarises the paragraph above?";
  }
  return p;
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600)
    .toString()
    .padStart(2, "0");
  const m = Math.floor((total % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const s = (total % 60).toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function Instructions({ section }: { section: string }) {
  const fullName = SECTION_FULL_NAMES[section] || section;
  return (
    <>
      <p style={{ fontWeight: 600, marginBottom: 12 }}>General Instructions for Candidate:</p>
      <ol style={{ paddingLeft: 20, lineHeight: 1.7, fontSize: 14 }}>
        <li>The test has 1 (one) section: {fullName}. The total duration is {SECTION_DURATION_MIN} minutes.</li>
        <li>
          As soon as you start the section the clock (top right of the screen) will start. On completion of{" "}
          {SECTION_DURATION_MIN} minutes, the section will auto-submit.
        </li>
        <li>The question paper has a mix of Multiple Choice (MCQ) and Type-In-The-Answer (TITA) questions.</li>
        <li>
          MCQ-type questions carry +3 for a correct answer, -1 for a wrong answer, and 0 for an unattempted
          question. TITA questions carry +3 for correct and 0 for wrong or unattempted - no negative marking.
        </li>
        <li>Your answers are saved to the server automatically as you work, in case of a refresh or disconnect.</li>
        <li>
          The question palette on the right shows each question&apos;s status: not visited, visited but not
          answered, answered, marked for review, or answered and marked for review.
        </li>
        <li>
          Click &lsquo;Save and Next&rsquo; to save your answer and move on, or &lsquo;Mark for Review &amp; Next&rsquo;
          to flag a question for a second look before you submit.
        </li>
      </ol>
    </>
  );
}

/** Sections that get the on-screen calculator, matching the real CAT exam
 * (VA/RC have none - there's nothing to compute). */
const CALC_SECTIONS = new Set(["DI", "LR", "QA"]);

export default function SolveClient({ attemptId }: { attemptId: string }) {
  const [data, setData] = useState<AttemptData | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [visited, setVisited] = useState<Set<string>>(new Set());
  const [current, setCurrent] = useState(0);
  const [reviewed, setReviewed] = useState(false);
  const [score, setScore] = useState<ScoreResult | null>(
    null,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [showQuestionPaper, setShowQuestionPaper] = useState(false);
  const [showCalc, setShowCalc] = useState(false);
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);
  // Strict mode (chosen on the instructions screen, before Start Test):
  // strict = real exam conditions - fullscreen lock, tab-switch detection,
  // no extra time. Flexible = practice-friendly - no window lockdown, and
  // a choice at time-up instead of a forced submit. Persisted alongside
  // the deadline so resuming an attempt keeps the mode you started with.
  const [strict, setStrict] = useState(false);
  // Sectional-only grace: when the clock hits zero, ask whether to submit as
  // timed or keep practicing untimed, instead of force-submitting outright.
  // Full mocks (once they exist) should skip this and always force-submit -
  // gate this whole block on an attempt "mode" once that mode is added.
  const [timeUp, setTimeUp] = useState(false);
  const [overtime, setOvertime] = useState(false);
  const timeUpHandled = useRef(false);
  // Anti-cheat: fullscreen exit / tab switch detection.
  const [violations, setViolations] = useState(0);
  const [showViolation, setShowViolation] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/attempts/${attemptId}`);
        const d = await res.json();
        if (!res.ok) {
          setError(d.error || "Could not load this set.");
          return;
        }
        setData(d);
        if (d.attempt.submitted) {
          setAnswers(d.attempt.answers || {});
          setReviewed(true);
          // Recompute from the raw answers rather than trusting the stored
          // score/total columns - older attempts predate the incorrect/
          // unanswered/rawScore breakdown, so recomputing gives every
          // attempt, old or new, the same consistent result shape.
          setScore(scoreSet(d.set, d.attempt.answers || {}));
        } else {
          // Restore a resumed attempt's saved answers, marked-for-review
          // state, and the clock's deadline. These ride inside the same
          // JSON blob under reserved keys so no schema migration is needed.
          const draft = { ...(d.attempt.answers || {}) } as Record<string, unknown>;
          const markedIds = Array.isArray(draft[MARKED_KEY]) ? (draft[MARKED_KEY] as string[]) : [];
          const savedDeadline = typeof draft[DEADLINE_KEY] === "number" ? (draft[DEADLINE_KEY] as number) : null;
          const savedStrict = draft[STRICT_KEY] === true;
          delete draft[MARKED_KEY];
          delete draft[DEADLINE_KEY];
          delete draft[STRICT_KEY];
          setAnswers(draft);
          setMarked(new Set(markedIds));
          setStrict(savedStrict);
          if (savedDeadline) setDeadline(savedDeadline);
        }
      } catch {
        setError("Network error.");
      }
    })();
  }, [attemptId]);

  const nav: NavItem[] = useMemo(() => {
    if (!data) return [];
    if (data.set.kind === "questions") {
      return (data.set.items ?? []).map((q) => ({ q }));
    }
    return (data.set.sets ?? []).flatMap((ss) =>
      ss.questions.map((q) => ({
        q,
        contextLabel: ss.contextLabel,
        context: ss.context,
        source: ss.source,
      })),
    );
  }, [data]);

  // Mark the current question visited whenever it changes.
  useEffect(() => {
    if (reviewed || nav.length === 0 || deadline === null) return;
    const id = nav[current]?.q.id;
    if (!id) return;
    setVisited((v) => (v.has(id) ? v : new Set(v).add(id)));
  }, [current, nav, reviewed, deadline]);

  const submit = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/attempts/${attemptId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error || "Could not submit.");
        return;
      }
      setScore({ correct: d.score, incorrect: d.incorrect, unanswered: d.unanswered, total: d.total, rawScore: d.rawScore });
      setReviewed(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }, [attemptId, answers]);

  // Sectional countdown - only runs once the candidate has clicked "Start
  // Test" (deadline is set). Persisted so a refresh can't reset the clock.
  // At zero: strict mode force-submits immediately (real exam conditions -
  // full mocks should always behave this way once that mode exists);
  // flexible mode offers a choice instead (see timeUp state above).
  useEffect(() => {
    if (reviewed || deadline === null) return;
    const tick = () => {
      const left = deadline - Date.now();
      setRemainingMs(left);
      if (left <= 0 && !timeUpHandled.current) {
        timeUpHandled.current = true;
        if (strict) submit();
        else setTimeUp(true);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadline, reviewed, strict, submit]);

  const saveDraft = useCallback(
    (nextAnswers: Record<string, unknown>, nextMarked: Set<string>, nextDeadline: number | null, nextStrict: boolean) => {
      const draft = {
        ...nextAnswers,
        [MARKED_KEY]: Array.from(nextMarked),
        [DEADLINE_KEY]: nextDeadline,
        [STRICT_KEY]: nextStrict,
      };
      fetch(`/api/attempts/${attemptId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: draft }),
      }).catch(() => {
        /* best-effort - the next edit will retry the save */
      });
    },
    [attemptId],
  );

  // Autosave: debounce a PATCH after answers/marked settle.
  useEffect(() => {
    if (reviewed || deadline === null) return;
    const id = setTimeout(() => saveDraft(answers, marked, deadline, strict), 1200);
    return () => clearTimeout(id);
  }, [answers, marked, deadline, strict, reviewed, saveDraft]);

  function startTest() {
    const d = Date.now() + SECTION_DURATION_MIN * 60_000;
    setDeadline(d);
    saveDraft(answers, marked, d, strict);
    if (strict && !DEV_MODE) {
      // Best-effort fullscreen - some browsers/embeds refuse it silently
      // even from a click handler, so a failure here should never block
      // the test. Flexible mode and local dev skip the lockdown entirely.
      document.documentElement.requestFullscreen?.().catch(() => {});
    }
  }

  const reportViolation = useCallback(() => {
    setViolations((v) => {
      const next = v + 1;
      if (next >= 3) submit();
      return next;
    });
    setShowViolation(true);
  }, [submit]);

  // Anti-cheat: flag leaving the tab/window or exiting fullscreen while a
  // timed section is in progress. Strict mode only, and never in local dev
  // (alt-tabbing to a terminal/devtools while testing is normal there, not
  // cheating). This can't physically stop someone from switching apps, but
  // it detects it, warns, and auto-submits after
  // repeated violations - the same trade-off real proctored exam software
  // makes. Not a substitute for identity/proctoring controls.
  useEffect(() => {
    if (reviewed || deadline === null || !strict || DEV_MODE) return;
    const onVisibility = () => {
      if (document.hidden) reportViolation();
    };
    const onBlur = () => reportViolation();
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) reportViolation();
    };
    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    const onCopy = (e: ClipboardEvent) => e.preventDefault();
    const onKeyDown = (e: KeyboardEvent) => {
      // Block the browser's own find-in-page, which would otherwise let a
      // candidate search the passage/options outside the exam UI.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") e.preventDefault();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCopy);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCopy);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [reviewed, deadline, strict, reportViolation]);

  const pick = useCallback((qid: string, idx: number) => {
    setAnswers((a) => ({ ...a, [qid]: idx }));
  }, []);

  const typeAnswer = useCallback((qid: string, value: string) => {
    setAnswers((a) => ({ ...a, [qid]: value }));
  }, []);

  const toggleMark = useCallback((qid: string) => {
    setMarked((m) => {
      const next = new Set(m);
      if (next.has(qid)) next.delete(qid);
      else next.add(qid);
      return next;
    });
  }, []);

  const clearResponse = useCallback((qid: string) => {
    setAnswers((a) => {
      const next = { ...a };
      delete next[qid];
      return next;
    });
  }, []);

  if (error)
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-red-600">{error}</p>
        <Link href="/dashboard" className="btn-ghost mt-4">
          Back to dashboard
        </Link>
      </main>
    );
  if (!data)
    return <main className="mx-auto max-w-3xl px-6 py-10 text-slate-400">Loading...</main>;

  const questions = data.set.kind === "questions" ? data.set.items ?? [] : [];
  const subsets = data.set.kind === "sets" ? data.set.sets ?? [] : [];
  const isEmpty =
    (data.set.kind === "questions" && questions.length === 0) ||
    (data.set.kind === "sets" && subsets.length === 0);

  let n = 0;
  function renderReviewQuestion(q: GenQuestion) {
    n += 1;
    const isTita = q.format === "tita";
    const chosen = answers[q.id] === undefined ? undefined : Number(answers[q.id]);
    const typedAnswer = String(answers[q.id] ?? "");
    const correctIdx = Number(q.answer);
    const prompt = withInstructionFallback(q);
    return (
      <div key={q.id} style={{ border: `1px solid ${EXAM_COLORS.border}`, borderRadius: 6, padding: 16, marginBottom: 16, background: "#fff" }}>
        <p style={{ fontWeight: 600, fontSize: 14 }}>
          <span style={{ color: EXAM_COLORS.textMuted }}>Q{n}.</span>{" "}
          <span style={{ whiteSpace: "pre-wrap" }}>{prompt}</span>
        </p>
        {isTita ? (
          <div style={{ marginTop: 12, maxWidth: 280, fontSize: 13 }}>
            <p>
              Your answer:{" "}
              <span style={{ fontFamily: "monospace", fontWeight: 700 }}>{typedAnswer || "—"}</span>
            </p>
            <p style={{ marginTop: 4 }}>
              Correct answer: <span style={{ fontWeight: 700 }}>{String(q.answer)}</span>
            </p>
          </div>
        ) : (
          <div style={{ marginTop: 10 }}>
            {q.options.map((opt, i) => {
              const isChosen = chosen === i;
              const isCorrect = correctIdx === i;
              let bg = "#fff";
              let border = EXAM_COLORS.border;
              if (isCorrect) {
                bg = EXAM_COLORS.answeredBg;
                border = EXAM_COLORS.answered;
              } else if (isChosen && !isCorrect) {
                bg = EXAM_COLORS.notAnsweredBg;
                border = EXAM_COLORS.notAnswered;
              }
              return (
                <div key={i} style={{ marginBottom: 6 }}>
                  <div style={{ border: `1px solid ${border}`, background: bg, borderRadius: 4, padding: "6px 10px", fontSize: 13 }}>
                    <span style={{ fontWeight: 600 }}>{String.fromCharCode(65 + i)}.</span> {opt}
                  </div>
                  <p style={{ marginTop: 3, paddingLeft: 10, fontSize: 12, color: EXAM_COLORS.textMuted }}>
                    {q.explanations[i]}
                  </p>
                </div>
              );
            })}
          </div>
        )}
        {q.solution && (
          <div style={{ marginTop: 10, background: EXAM_COLORS.tabBarBg, borderRadius: 4, padding: 10, fontSize: 13 }}>
            <span style={{ fontWeight: 600 }}>Solution: </span>
            <span style={{ whiteSpace: "pre-wrap" }}>{q.solution}</span>
          </div>
        )}
      </div>
    );
  }

  // ---- Post-submit review: same light exam styling as the live test,
  // so a submitted attempt never looks like a different piece of software. --
  if (reviewed) {
    return (
      <div style={{ minHeight: "100vh", background: EXAM_COLORS.panelBg, color: EXAM_COLORS.text, colorScheme: "light" }}>
        <div style={{ background: EXAM_COLORS.headerBg, color: EXAM_COLORS.headerText, padding: "10px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
          <span style={{ fontWeight: 600 }}>{SECTION_FULL_NAMES[data.set.section] || data.set.section} Sectional - Result</span>
          <Link href="/dashboard" style={{ color: EXAM_COLORS.headerText, textDecoration: "none" }}>
            &larr; Dashboard
          </Link>
        </div>
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "24px 20px 60px" }}>
          {score && (
            <div
              style={{
                marginBottom: 24,
                borderRadius: 8,
                padding: 24,
                background: EXAM_COLORS.tabActiveBg,
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 24,
                flexWrap: "wrap",
              }}
            >
              <div>
                <p style={{ fontSize: 24, fontWeight: 700 }}>{score.rawScore} marks</p>
                {score.total > 0 && (
                  <p style={{ fontSize: 15, opacity: 0.85 }}>{Math.round((score.correct / score.total) * 100)}% correct</p>
                )}
                <p style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>Review the explanations for every option below.</p>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 32,
                  borderLeft: "1px solid rgba(255,255,255,0.3)",
                  paddingLeft: 24,
                  textAlign: "center",
                }}
              >
                <div>
                  <p style={{ fontSize: 26, fontWeight: 700 }}>{score.correct}</p>
                  <p style={{ fontSize: 12, opacity: 0.8 }}>Correct</p>
                </div>
                <div>
                  <p style={{ fontSize: 26, fontWeight: 700 }}>{score.incorrect}</p>
                  <p style={{ fontSize: 12, opacity: 0.8 }}>Incorrect</p>
                </div>
                <div>
                  <p style={{ fontSize: 26, fontWeight: 700 }}>{score.unanswered}</p>
                  <p style={{ fontSize: 12, opacity: 0.8 }}>Unanswered</p>
                </div>
              </div>
            </div>
          )}
          {isEmpty && (
            <div style={{ border: `1px solid ${EXAM_COLORS.border}`, borderRadius: 6, padding: 16 }}>
              <p style={{ fontWeight: 600 }}>This set could not be generated.</p>
              <p style={{ marginTop: 8, fontSize: 13, color: EXAM_COLORS.textMuted }}>
                The model was unable to produce a valid {data.set.section} set this time. Please go
                back to the dashboard and click <strong>Generate a new set</strong> again - a fresh attempt
                usually succeeds.
              </p>
            </div>
          )}
          {data.set.kind === "questions" && questions.length > 0 && questions.map(renderReviewQuestion)}
          {data.set.kind === "sets" &&
            subsets.map((ss) => (
              <div key={ss.id} style={{ marginBottom: 28 }}>
                <div style={{ border: `1px solid ${EXAM_COLORS.border}`, borderRadius: 6, padding: 16, marginBottom: 14, background: EXAM_COLORS.paletteBg }}>
                  <p style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{ss.contextLabel}</p>
                  <div
                    style={{ fontSize: 13, lineHeight: 1.6 }}
                    dangerouslySetInnerHTML={{ __html: renderContext(ss.context) }}
                  />
                  {ss.source && <p style={{ marginTop: 8, fontSize: 11, color: EXAM_COLORS.textMuted }}>Source: {ss.source}</p>}
                </div>
                {ss.questions.map(renderReviewQuestion)}
              </div>
            ))}
          <Link
            href="/dashboard"
            style={{ display: "inline-block", marginTop: 8, border: `1px solid ${EXAM_COLORS.border}`, borderRadius: 4, padding: "8px 20px", fontSize: 13, textDecoration: "none", color: EXAM_COLORS.text }}
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (isEmpty) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="card p-5">
          <p className="font-medium text-slate-900">This set could not be generated.</p>
          <p className="mt-2 text-sm text-slate-600">
            The model was unable to produce a valid {data.set.section} set this time. Please go back
            to the dashboard and click <span className="font-semibold">Generate a new set</span> again -
            a fresh attempt usually succeeds.
          </p>
        </div>
        <Link href="/dashboard" className="btn-ghost mt-4">
          Back to dashboard
        </Link>
      </main>
    );
  }

  const sectionTitle = `${SECTION_FULL_NAMES[data.set.section] || data.set.section} Sectional`;

  // ---- Instructions gate: shown once, before the clock starts -----------
  if (deadline === null) {
    return (
      <div style={{ minHeight: "100vh", background: EXAM_COLORS.panelBg, color: EXAM_COLORS.text, colorScheme: "light" }}>
        <div style={{ background: EXAM_COLORS.headerBg, color: EXAM_COLORS.headerText, padding: "10px 20px", fontSize: 14, fontWeight: 600 }}>
          {sectionTitle} - Instructions
        </div>
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 20px 90px" }}>
          <p style={{ fontWeight: 700, fontSize: 18 }}>{sectionTitle}</p>
          <p style={{ marginTop: 8, fontSize: 20, fontWeight: 700 }}>{formatClock(SECTION_DURATION_MIN * 60_000)}</p>
          <p style={{ fontSize: 12, color: EXAM_COLORS.textMuted, marginBottom: 20 }}>Section duration</p>
          <Instructions section={data.set.section} />

          <div style={{ marginTop: 20, padding: 16, border: `1px solid ${EXAM_COLORS.border}`, borderRadius: 6, maxWidth: 520 }}>
            <p style={{ fontWeight: 700, marginBottom: 10, fontSize: 14 }}>Choose test conditions</p>
            <label style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "6px 0", cursor: "pointer" }}>
              <input type="radio" checked={strict} onChange={() => setStrict(true)} style={{ marginTop: 3 }} />
              <span style={{ fontSize: 13 }}>
                <strong>Strict</strong> - real exam conditions. Fullscreen is enforced, switching tabs or windows is
                flagged and auto-submits after 3 warnings, and time&apos;s up ends the section immediately. No extra
                time.
              </span>
            </label>
            <label style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "6px 0", cursor: "pointer" }}>
              <input type="radio" checked={!strict} onChange={() => setStrict(false)} style={{ marginTop: 3 }} />
              <span style={{ fontSize: 13 }}>
                <strong>Flexible</strong> - practice-friendly. No fullscreen lock or tab-switch detection, and
                when time&apos;s up you can choose to submit or keep practicing untimed.
              </span>
            </label>
          </div>
        </div>
        <div
          style={{
            position: "fixed",
            bottom: 0,
            left: 0,
            right: 0,
            background: EXAM_COLORS.panelBg,
            borderTop: `1px solid ${EXAM_COLORS.border}`,
            padding: "12px 20px",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <button
            onClick={startTest}
            style={{ background: EXAM_COLORS.primary, color: "#fff", border: "none", borderRadius: 4, padding: "10px 28px", fontWeight: 600, cursor: "pointer" }}
          >
            Start Test
          </button>
        </div>
      </div>
    );
  }

  const item = nav[current];
  const total = nav.length;
  const answeredCount = nav.filter((it) => answers[it.q.id] !== undefined && String(answers[it.q.id]).trim() !== "").length;
  const notAnsweredCount = nav.filter(
    (it) => visited.has(it.q.id) && !marked.has(it.q.id) && (answers[it.q.id] === undefined || String(answers[it.q.id]).trim() === ""),
  ).length;
  const notVisitedCount = nav.filter((it) => !visited.has(it.q.id)).length;
  const markedOnlyCount = nav.filter(
    (it) => marked.has(it.q.id) && (answers[it.q.id] === undefined || String(answers[it.q.id]).trim() === ""),
  ).length;
  const answeredMarkedCount = nav.filter(
    (it) => marked.has(it.q.id) && answers[it.q.id] !== undefined && String(answers[it.q.id]).trim() !== "",
  ).length;
  const unansweredForSubmit = total - answeredCount;
  const lowTime = remainingMs !== null && remainingMs < 5 * 60_000;
  const isTita = item.q.format === "tita";
  const chosen = answers[item.q.id] === undefined ? undefined : Number(answers[item.q.id]);
  const typedAnswer = String(answers[item.q.id] ?? "");
  const isMarked = marked.has(item.q.id);
  const isAnswered = answers[item.q.id] !== undefined && String(answers[item.q.id]).trim() !== "";

  function statusOf(qid: string): "answered" | "marked" | "answered-marked" | "visited" | "unvisited" {
    const answered = answers[qid] !== undefined && String(answers[qid]).trim() !== "";
    const isMarkedQ = marked.has(qid);
    if (answered && isMarkedQ) return "answered-marked";
    if (isMarkedQ) return "marked";
    if (answered) return "answered";
    if (visited.has(qid)) return "visited";
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
    toggleMark(item.q.id);
    if (current < total - 1) goTo(current + 1);
  }

  const statBoxes: { label: string; count: number; color: string; bg: string; checkBadge?: boolean }[] = [
    { label: "Answered", count: answeredCount, color: EXAM_COLORS.answered, bg: EXAM_COLORS.answeredBg },
    { label: "Not Answered", count: notAnsweredCount, color: EXAM_COLORS.notAnswered, bg: EXAM_COLORS.notAnsweredBg },
    { label: "Not Visited", count: notVisitedCount, color: EXAM_COLORS.notVisitedText, bg: EXAM_COLORS.notVisited },
    { label: "Marked for Review", count: markedOnlyCount, color: EXAM_COLORS.marked, bg: EXAM_COLORS.markedBg },
    {
      label: "Answered & Marked for Review",
      count: answeredMarkedCount,
      color: EXAM_COLORS.marked,
      bg: EXAM_COLORS.markedBg,
      checkBadge: true,
    },
  ];

  return (
    <div style={{ minHeight: "100vh", background: EXAM_COLORS.panelBg, color: EXAM_COLORS.text, colorScheme: "light", userSelect: "none" }}>
      {/* Top bar */}
      <div style={{ background: EXAM_COLORS.headerBg, color: EXAM_COLORS.headerText, padding: "10px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
        <span style={{ fontWeight: 600 }}>{sectionTitle}</span>
        <div style={{ display: "flex", gap: 16 }}>
          <button onClick={() => setShowQuestionPaper(true)} style={{ background: "none", border: "none", color: EXAM_COLORS.headerText, cursor: "pointer", fontSize: 13 }}>
            Question Paper
          </button>
          {CALC_SECTIONS.has(data.set.section) && (
            <button onClick={() => setShowCalc((v) => !v)} style={{ background: "none", border: "none", color: EXAM_COLORS.headerText, cursor: "pointer", fontSize: 13 }}>
              Calculator
            </button>
          )}
          <button onClick={() => setShowInstructions(true)} style={{ background: "none", border: "none", color: EXAM_COLORS.headerText, cursor: "pointer", fontSize: 13 }}>
            View Instructions
          </button>
          <Link href="/dashboard" style={{ color: EXAM_COLORS.headerText, textDecoration: "none" }}>
            Exit
          </Link>
        </div>
      </div>

      {/* Timer + marks row */}
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "baseline", gap: 16, padding: "8px 20px 4px", borderBottom: `1px solid ${EXAM_COLORS.border}` }}>
        <span style={{ fontSize: 12, color: EXAM_COLORS.textMuted }}>
          Marks for correct answer 3 | Negative Marks {isTita ? 0 : 1}
        </span>
        <span
          style={{
            fontWeight: 700,
            fontSize: 14,
            color: overtime ? "#b8860b" : lowTime ? EXAM_COLORS.notAnswered : EXAM_COLORS.text,
          }}
        >
          {overtime
            ? `Overtime (practice) : +${formatClock(Math.abs(remainingMs ?? 0))}`
            : `Time Left : ${remainingMs === null ? formatClock(SECTION_DURATION_MIN * 60_000) : formatClock(remainingMs)}`}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "stretch" }}>
        {/* Passage pane (RC/DI/LR only) */}
        {item.context && (
          <div style={{ flex: 1, borderRight: `1px solid ${EXAM_COLORS.border}`, padding: 16, height: "calc(100vh - 156px)", overflowY: "auto" }}>
            <p style={{ fontWeight: 700, marginBottom: 8, fontSize: 14 }}>{item.contextLabel}</p>
            <div
              style={{ fontSize: 14, lineHeight: 1.6 }}
              dangerouslySetInnerHTML={{ __html: renderContext(item.context) }}
            />
            {item.source && <p style={{ marginTop: 8, fontSize: 11, color: EXAM_COLORS.textMuted }}>Source: {item.source}</p>}
          </div>
        )}

        {/* Question pane */}
        <div style={{ flex: 1, borderRight: `1px solid ${EXAM_COLORS.border}`, padding: 16, height: "calc(100vh - 156px)", overflowY: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <p style={{ fontWeight: 700, fontSize: 14 }}>Question No. {current + 1}</p>
            <button
              onClick={() => toggleMark(item.q.id)}
              style={{
                fontSize: 11,
                fontWeight: 600,
                border: `1px solid ${isMarked ? EXAM_COLORS.marked : EXAM_COLORS.border}`,
                background: isMarked ? EXAM_COLORS.markedBg : "#fff",
                color: isMarked ? EXAM_COLORS.marked : EXAM_COLORS.textMuted,
                borderRadius: 4,
                padding: "4px 10px",
                cursor: "pointer",
              }}
            >
              {isMarked ? "Marked" : "Mark for Review"}
            </button>
          </div>
          <p style={{ fontSize: 14, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{withInstructionFallback(item.q)}</p>

          {isTita ? (
            <div style={{ marginTop: 16, maxWidth: 260 }}>
              <input
                value={typedAnswer}
                onChange={(e) => typeAnswer(item.q.id, e.target.value)}
                inputMode="decimal"
                placeholder="Type your answer"
                style={{ width: "100%", border: `1px solid ${EXAM_COLORS.border}`, borderRadius: 4, padding: "8px 10px", fontSize: 14, fontFamily: "monospace" }}
              />
            </div>
          ) : (
            <div style={{ marginTop: 16 }}>
              {item.q.options.map((opt, i) => (
                <label key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", fontSize: 14, cursor: "pointer" }}>
                  <input type="radio" checked={chosen === i} onChange={() => pick(item.q.id, i)} style={{ marginTop: 3 }} />
                  <span>{opt}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Collapse toggle: hides the palette so the passage/question panes
         * can use the full width, matching the reference exam software. */}
        <button
          onClick={() => setPaletteCollapsed((c) => !c)}
          title={paletteCollapsed ? "Show question palette" : "Hide question palette"}
          style={{
            position: "sticky",
            top: "50%",
            width: 18,
            height: 40,
            flexShrink: 0,
            border: "none",
            background: EXAM_COLORS.answered,
            color: "#fff",
            cursor: "pointer",
            borderRadius: "4px 0 0 4px",
            fontSize: 12,
          }}
        >
          {paletteCollapsed ? "‹" : "›"}
        </button>

        {/* Question palette */}
        <div
          style={{
            width: paletteCollapsed ? 0 : 300,
            flexShrink: 0,
            background: EXAM_COLORS.paletteBg,
            padding: paletteCollapsed ? 0 : 16,
            height: "calc(100vh - 156px)",
            overflowY: "auto",
            overflowX: "hidden",
            transition: "width 0.15s ease, padding 0.15s ease",
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
            {statBoxes.map((s) => (
              <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                <span
                  style={{
                    position: "relative",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 22,
                    height: 22,
                    borderRadius: 4,
                    background: s.bg,
                    color: s.color,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {s.count}
                  {s.checkBadge && (
                    <span
                      style={{
                        position: "absolute",
                        bottom: -6,
                        right: -6,
                        width: 16,
                        height: 16,
                        borderRadius: "50%",
                        background: EXAM_COLORS.answered,
                        color: "#fff",
                        fontSize: 11,
                        fontWeight: 700,
                        lineHeight: "14px",
                        border: "2px solid #fff",
                      }}
                    >
                      ✓
                    </span>
                  )}
                </span>
                <span style={{ color: EXAM_COLORS.textMuted }}>{s.label}</span>
              </div>
            ))}
          </div>

          <div style={{ background: EXAM_COLORS.tabActiveBg, color: "#fff", padding: "6px 10px", fontSize: 12, fontWeight: 600, borderRadius: "4px 4px 0 0" }}>
            {sectionTitle}
          </div>
          <div style={{ background: "#fff", border: `1px solid ${EXAM_COLORS.border}`, borderTop: "none", borderRadius: "0 0 4px 4px", padding: 12 }}>
            <p style={{ fontSize: 11, color: EXAM_COLORS.textMuted, marginBottom: 8 }}>Choose a question</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
              {nav.map((it, idx) => {
                const status = statusOf(it.q.id);
                const st = paletteStyle[status];
                return (
                  <button
                    key={it.q.id}
                    onClick={() => goTo(idx)}
                    style={{
                      position: "relative",
                      width: 32,
                      height: 32,
                      borderRadius: 4,
                      border: idx === current ? `2px solid ${EXAM_COLORS.text}` : `1px solid ${st.border}`,
                      background: st.bg,
                      color: st.color,
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {idx + 1}
                    {/* Answered & Marked gets a green corner check so it reads
                     * differently from plain Marked at a glance. */}
                    {status === "answered-marked" && (
                      <span
                        style={{
                          position: "absolute",
                          bottom: -6,
                          right: -6,
                          width: 18,
                          height: 18,
                          borderRadius: "50%",
                          background: EXAM_COLORS.answered,
                          color: "#fff",
                          fontSize: 12,
                          fontWeight: 700,
                          lineHeight: "16px",
                          border: "2px solid #fff",
                        }}
                      >
                        ✓
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            onClick={() => setConfirmOpen(true)}
            disabled={busy}
            style={{ marginTop: 16, width: "100%", background: EXAM_COLORS.primary, color: "#fff", border: "none", borderRadius: 4, padding: "10px 0", fontWeight: 600, cursor: "pointer" }}
          >
            {busy ? "Submitting..." : "Submit test"}
          </button>
          {error && <p style={{ marginTop: 8, fontSize: 12, color: EXAM_COLORS.notAnswered }}>{error}</p>}
        </div>
      </div>

      {/* Bottom action bar - pinned to the viewport so it never shifts with
       * content height (matches the real exam software's fixed footer). */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          borderTop: `1px solid ${EXAM_COLORS.border}`,
          background: "#fff",
          padding: "10px 20px",
          display: "flex",
          justifyContent: "space-between",
          zIndex: 20,
        }}
      >
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={markAndNext}
            style={{ border: `1px solid ${EXAM_COLORS.border}`, background: "#fff", borderRadius: 4, padding: "8px 14px", fontSize: 13, cursor: "pointer" }}
          >
            Mark For Review &amp; Next
          </button>
          <button
            onClick={() => clearResponse(item.q.id)}
            disabled={!isAnswered}
            style={{ border: `1px solid ${EXAM_COLORS.border}`, background: "#fff", borderRadius: 4, padding: "8px 14px", fontSize: 13, cursor: isAnswered ? "pointer" : "not-allowed", opacity: isAnswered ? 1 : 0.5 }}
          >
            Clear Response
          </button>
        </div>
        {current < total - 1 ? (
          <button
            onClick={saveAndNext}
            style={{ background: EXAM_COLORS.primary, color: "#fff", border: "none", borderRadius: 4, padding: "8px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
          >
            Save and Next
          </button>
        ) : (
          <button
            onClick={() => setConfirmOpen(true)}
            disabled={busy}
            style={{ background: EXAM_COLORS.primary, color: "#fff", border: "none", borderRadius: 4, padding: "8px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
          >
            Save and Submit
          </button>
        )}
      </div>

      {/* Submit confirmation */}
      {confirmOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 30 }}>
          <div style={{ background: "#fff", borderRadius: 8, padding: 24, maxWidth: 360, width: "90%" }}>
            <p style={{ fontWeight: 700, marginBottom: 8 }}>Submit this section?</p>
            <p style={{ fontSize: 13, color: EXAM_COLORS.textMuted, marginBottom: 16 }}>
              {unansweredForSubmit > 0
                ? `${unansweredForSubmit} question${unansweredForSubmit === 1 ? "" : "s"} left unanswered. You can't change answers after submitting.`
                : "All questions answered. You can't change answers after submitting."}
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={() => setConfirmOpen(false)}
                style={{ border: `1px solid ${EXAM_COLORS.border}`, background: "#fff", borderRadius: 4, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}
              >
                Keep working
              </button>
              <button
                onClick={() => {
                  setConfirmOpen(false);
                  submit();
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

      {/* Time-up choice: sectional practice only - a full mock (once it
       * exists) should force-submit here instead of offering a choice. */}
      {timeUp && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 40 }}>
          <div style={{ background: "#fff", borderRadius: 8, padding: 24, maxWidth: 380, width: "90%" }}>
            <p style={{ fontWeight: 700, marginBottom: 8 }}>Time&apos;s up</p>
            <p style={{ fontSize: 13, color: EXAM_COLORS.textMuted, marginBottom: 16 }}>
              The {SECTION_DURATION_MIN}-minute section timer has ended. Submit now to have this scored as
              a timed attempt, or keep practicing untimed - untimed extra time is only offered on
              individual sectionals, not full mocks.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={() => {
                  setTimeUp(false);
                  setOvertime(true);
                }}
                style={{ border: `1px solid ${EXAM_COLORS.border}`, background: "#fff", borderRadius: 4, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}
              >
                Keep practicing
              </button>
              <button
                onClick={() => {
                  setTimeUp(false);
                  submit();
                }}
                disabled={busy}
                style={{ background: EXAM_COLORS.primary, color: "#fff", border: "none", borderRadius: 4, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
              >
                Submit now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Anti-cheat violation warning */}
      {showViolation && !timeUp && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 40 }}>
          <div style={{ background: "#fff", borderRadius: 8, padding: 24, maxWidth: 380, width: "90%" }}>
            <p style={{ fontWeight: 700, marginBottom: 8, color: EXAM_COLORS.notAnswered }}>
              Warning {violations}/3: left the test window
            </p>
            <p style={{ fontSize: 13, color: EXAM_COLORS.textMuted, marginBottom: 16 }}>
              Switching tabs, exiting fullscreen, or leaving this window is flagged. Reaching 3 warnings
              auto-submits the section.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={() => {
                  setShowViolation(false);
                  document.documentElement.requestFullscreen?.().catch(() => {});
                }}
                style={{ background: EXAM_COLORS.primary, color: "#fff", border: "none", borderRadius: 4, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
              >
                Resume test
              </button>
            </div>
          </div>
        </div>
      )}

      {showCalc && CALC_SECTIONS.has(data.set.section) && <Calculator onClose={() => setShowCalc(false)} />}

      {/* View Instructions overlay */}
      {showInstructions && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 30 }}>
          <div style={{ background: "#fff", borderRadius: 8, padding: 24, maxWidth: 640, width: "90%", maxHeight: "80vh", overflowY: "auto" }}>
            <Instructions section={data.set.section} />
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <button
                onClick={() => setShowInstructions(false)}
                style={{ background: EXAM_COLORS.primary, color: "#fff", border: "none", borderRadius: 4, padding: "8px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Question Paper overlay: the whole paper, full text and options,
       * scrollable top to bottom like a physical paper. Read-only - it's a
       * reference view, not an alternate way to answer. */}
      {showQuestionPaper && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 30 }}>
          <div style={{ background: "#fff", borderRadius: 8, padding: 24, maxWidth: 760, width: "94%", maxHeight: "88vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, position: "sticky", top: -24, background: "#fff", paddingTop: 24, marginTop: -24 }}>
              <p style={{ fontWeight: 700 }}>Question Paper - {sectionTitle}</p>
              <button
                onClick={() => setShowQuestionPaper(false)}
                style={{ background: EXAM_COLORS.primary, color: "#fff", border: "none", borderRadius: 4, padding: "6px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
              >
                Close
              </button>
            </div>
            {(data.set.kind === "sets" ? subsets : [null]).map((ss, groupIdx) => {
              const groupItems = ss ? nav.filter((it) => it.contextLabel === ss.contextLabel && it.context === ss.context) : nav;
              return (
                <div key={ss ? ss.id : "flat"} style={{ marginBottom: 28 }}>
                  {ss && (
                    <div style={{ marginBottom: 12, padding: 12, background: EXAM_COLORS.paletteBg, borderRadius: 6 }}>
                      <p style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{ss.contextLabel}</p>
                      <div style={{ fontSize: 13, lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: renderContext(ss.context) }} />
                    </div>
                  )}
                  {groupItems.map((it) => {
                    const idx = nav.indexOf(it);
                    return (
                      <div key={it.q.id} style={{ marginBottom: 18 }}>
                        <p style={{ fontWeight: 600, fontSize: 14, whiteSpace: "pre-wrap" }}>
                          Q{idx + 1}. {withInstructionFallback(it.q)}
                        </p>
                        {it.q.format === "tita" ? (
                          <p style={{ fontSize: 13, color: EXAM_COLORS.textMuted, marginTop: 4 }}>(Type-in-the-answer question)</p>
                        ) : (
                          <div style={{ marginTop: 6 }}>
                            {it.q.options.map((opt, i) => (
                              <p key={i} style={{ fontSize: 13, margin: "4px 0" }}>
                                <span style={{ fontWeight: 600 }}>{String.fromCharCode(65 + i)}.</span> {opt}
                              </p>
                            ))}
                          </div>
                        )}
                        <button
                          onClick={() => {
                            goTo(idx);
                            setShowQuestionPaper(false);
                          }}
                          style={{ marginTop: 6, fontSize: 12, color: EXAM_COLORS.primary, background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline" }}
                        >
                          Go to this question
                        </button>
                      </div>
                    );
                  })}
                  {groupIdx < (data.set.kind === "sets" ? subsets.length : 1) - 1 && (
                    <hr style={{ border: "none", borderTop: `1px solid ${EXAM_COLORS.border}`, margin: "18px 0" }} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

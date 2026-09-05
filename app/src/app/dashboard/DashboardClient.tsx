"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
const SET_SHAPE: Record<Section, string> = {
  VA: "10 questions - para-completion, para-jumble, odd-one-out, summary",
  RC: "2 passages, 4 questions each",
  DI: "2 data-interpretation sets",
  LR: "2 logical-reasoning sets",
  QA: "10 questions - geometry, algebra, arithmetic, number system, modern math",
};

interface AttemptRow {
  id: number;
  section: string;
  submitted: boolean;
  score: number | null;
  total: number | null;
  createdAt: string;
}
interface MockRow {
  id: number;
  submitted: boolean;
  createdAt: string;
}

export default function DashboardClient({ username }: { username: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"sectional" | "mock">("sectional");
  const [tab, setTab] = useState<Section>("VA");
  const [attempts, setAttempts] = useState<AttemptRow[]>([]);
  const [mockList, setMockList] = useState<MockRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [startingMock, setStartingMock] = useState(false);
  const [retaking, setRetaking] = useState<number | null>(null);
  const [error, setError] = useState("");

  const loadMocks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/mocks");
      const data = await res.json();
      setMockList(res.ok ? data.mocks : []);
    } catch {
      setMockList([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAttempts = useCallback(async (section: Section) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/attempts?section=${section}`);
      const data = await res.json();
      setAttempts(res.ok ? data.attempts : []);
    } catch {
      setAttempts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mode === "sectional") loadAttempts(tab);
    else loadMocks();
  }, [mode, tab, loadAttempts, loadMocks]);

  async function generate() {
    setError("");
    setGenerating(true);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: tab }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Generation failed.");
        return;
      }
      router.push(`/practice/${data.attemptId}`);
    } catch {
      setError("Network error during generation.");
    } finally {
      setGenerating(false);
    }
  }

  async function retake(attemptId: number) {
    setError("");
    setRetaking(attemptId);
    try {
      const res = await fetch(`/api/attempts/${attemptId}/retake`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not start a retake.");
        return;
      }
      router.push(`/practice/${data.attemptId}`);
    } catch {
      setError("Network error starting the retake.");
    } finally {
      setRetaking(null);
    }
  }

  async function startMock() {
    setError("");
    setStartingMock(true);
    try {
      const res = await fetch("/api/mocks", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not build the mock.");
        return;
      }
      router.push(`/mocks/${data.mockId}`);
    } catch {
      setError("Network error building the mock.");
    } finally {
      setStartingMock(false);
    }
  }

  return (
    <div className="app-shell min-h-screen">
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <span className="display-type text-xl font-bold text-slate-900">CAT practice</span>
          <div className="flex items-center gap-5 text-sm">
            <Link href="/dashboard" className="font-medium text-brand">
              Dashboard
            </Link>
            <Link href="/analysis" className="font-medium text-slate-500 hover:text-brand">
              Analysis
            </Link>
            <Link href="/revise" className="font-medium text-slate-500 hover:text-brand">
              Revise
            </Link>
            <ThemeToggle />
            <UserMenu username={username} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand">Practice desk</p>
          <h1 className="display-type mt-3 text-4xl font-bold text-slate-900 sm:text-5xl">Choose a focus for today.</h1>
          <p className="mt-3 text-slate-600">
            {mode === "sectional"
              ? "Build a practice habit one section at a time. Your completed sets remain here for review."
              : "A full 3-hour CAT: VARC, then DILR, then QA, 40 minutes each, back to back."}
          </p>
        </div>

        <div className="mt-6 flex gap-2">
          {(["sectional", "mock"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={
                "rounded-lg px-4 py-2 text-sm font-semibold capitalize " +
                (mode === m ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-600 hover:bg-slate-50")
              }
            >
              {m === "sectional" ? "Sectional" : "Full Mock"}
            </button>
          ))}
        </div>

        {mode === "sectional" ? (
          <>
            <div className="mt-6 flex flex-wrap gap-2">
              {SECTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setTab(s)}
                  className={
                    "rounded-lg px-4 py-2 text-sm font-medium transition-colors " +
                    (tab === s
                      ? "bg-brand text-white"
                      : "bg-white text-slate-600 border border-slate-300 hover:bg-slate-50")
                  }
                >
                  {s}
                </button>
              ))}
            </div>

            <section className="card mt-6 p-6">
              <h2 className="text-lg font-semibold text-slate-900">
                {SECTION_NAMES[tab]}
              </h2>
              <p className="mt-1 text-sm text-slate-500">{SET_SHAPE[tab]}</p>
              {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
              <button
                onClick={generate}
                className="btn-primary mt-4"
                disabled={generating}
              >
                {generating ? "Generating - this can take a minute..." : "Generate a new set"}
              </button>
            </section>

            <section className="mt-8">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Previously generated {tab} sets
              </h3>
              {loading ? (
                <div className="mt-4 space-y-2" aria-label="Loading previous sets">
                  <div className="skeleton h-16 rounded-2xl" />
                  <div className="skeleton h-16 rounded-2xl" />
                </div>
              ) : attempts.length === 0 ? (
                <p className="mt-3 text-sm text-slate-400">
                  No sets yet. Generate your first one above.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {attempts.map((a) =>
                    a.submitted ? (
                      <li key={a.id} className="card flex items-center justify-between p-4">
                        <div>
                          <p className="text-sm text-slate-600">
                            Set #{a.id} - {new Date(a.createdAt + "Z").toLocaleString()}
                          </p>
                          <p className="text-sm font-medium text-brand">
                            Score {a.score}/{a.total}
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <Link href={`/practice/${a.id}`} className="btn-ghost">
                            View breakdown
                          </Link>
                          <button onClick={() => retake(a.id)} className="btn-primary" disabled={retaking === a.id}>
                            {retaking === a.id ? "Starting..." : "Retake test"}
                          </button>
                        </div>
                      </li>
                    ) : (
                      <li key={a.id}>
                        <Link
                          href={`/practice/${a.id}`}
                          className="card flex items-center justify-between p-4 hover:bg-slate-50"
                        >
                          <span className="text-sm text-slate-600">
                            Set #{a.id} - {new Date(a.createdAt + "Z").toLocaleString()}
                          </span>
                          <span className="text-sm font-medium text-amber-600">Not attempted</span>
                        </Link>
                      </li>
                    ),
                  )}
                </ul>
              )}
            </section>
          </>
        ) : (
          <>
            <section className="card mt-6 p-6">
              <h2 className="text-lg font-semibold text-slate-900">Full Mock</h2>
              <p className="mt-1 text-sm text-slate-500">
                Three timed sections in one sitting - VARC, DILR, then QA, 40 minutes each (120 total). Once a
                section&apos;s time is up it auto-submits and the next one starts; there&apos;s no going back.
              </p>
              {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
              <button onClick={startMock} className="btn-primary mt-4" disabled={startingMock}>
                {startingMock ? "Building your mock..." : "Start a full mock"}
              </button>
            </section>

            <section className="mt-8">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Previous mocks</h3>
              {loading ? (
                <div className="mt-4 space-y-2" aria-label="Loading previous mocks">
                  <div className="skeleton h-16 rounded-2xl" />
                </div>
              ) : mockList.length === 0 ? (
                <p className="mt-3 text-sm text-slate-400">No mocks yet. Start your first one above.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {mockList.map((m) => (
                    <li key={m.id}>
                      <Link href={`/mocks/${m.id}`} className="card flex items-center justify-between p-4 hover:bg-slate-50">
                        <span className="text-sm text-slate-600">
                          Mock #{m.id} - {new Date(m.createdAt + "Z").toLocaleString()}
                        </span>
                        <span className={"text-sm font-medium " + (m.submitted ? "text-brand" : "text-amber-600")}>
                          {m.submitted ? "View result" : "In progress"}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

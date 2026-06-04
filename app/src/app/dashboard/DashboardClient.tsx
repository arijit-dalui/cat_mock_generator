"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

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

export default function DashboardClient({ username }: { username: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<Section>("VA");
  const [attempts, setAttempts] = useState<AttemptRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

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
    loadAttempts(tab);
  }, [tab, loadAttempts]);

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

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <span className="font-bold text-slate-900">CAT Mock Generator</span>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/profile" className="font-medium text-brand">
              {username}
            </Link>
            <button onClick={logout} className="btn-ghost">
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        <div className="flex flex-wrap gap-2">
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
            <p className="mt-3 text-sm text-slate-400">Loading...</p>
          ) : attempts.length === 0 ? (
            <p className="mt-3 text-sm text-slate-400">
              No sets yet. Generate your first one above.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {attempts.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/practice/${a.id}`}
                    className="card flex items-center justify-between p-4 hover:bg-slate-50"
                  >
                    <span className="text-sm text-slate-600">
                      Set #{a.id} - {new Date(a.createdAt + "Z").toLocaleString()}
                    </span>
                    <span className="text-sm font-medium">
                      {a.submitted ? (
                        <span className="text-brand">
                          Score {a.score}/{a.total}
                        </span>
                      ) : (
                        <span className="text-amber-600">Not attempted</span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ThemeToggle from "../../components/ThemeToggle";
import UserMenu from "../../components/UserMenu";

const SECTION_NAMES: Record<string, string> = {
  VA: "Verbal Ability",
  RC: "Reading Comprehension",
  DI: "Data Interpretation",
  LR: "Logical Reasoning",
  QA: "Quantitative Ability",
};

const SOCIAL_ICONS: Record<string, string> = {
  reddit: "Reddit",
  instagram: "Instagram",
  twitter: "Twitter / X",
  linkedin: "LinkedIn",
};

interface PublicProfile {
  username: string;
  createdAt: string;
  socialLinks: Record<string, string>;
  sections: Record<string, { bestScore: number; percentile: number; population: number } | null>;
}

function fmtDate(s: string): string {
  const d = new Date(/T/.test(s) ? s : s.replace(" ", "T") + "Z");
  return isNaN(d.getTime()) ? s : d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export default function PublicProfileClient({ username, viewerUsername }: { username: string; viewerUsername: string }) {
  const [data, setData] = useState<PublicProfile | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/users/${encodeURIComponent(username)}`);
        const d = await res.json();
        if (!res.ok) {
          setError(d.error || "Could not load this profile.");
          return;
        }
        setData(d);
      } catch {
        setError("Network error.");
      }
    })();
  }, [username]);

  return (
    <div className="app-shell min-h-screen">
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <span className="display-type text-xl font-bold text-slate-900">CAT practice</span>
          <div className="flex items-center gap-5 text-sm">
            <Link href="/dashboard" className="font-medium text-slate-500 hover:text-brand">
              Dashboard
            </Link>
            <Link href="/analysis" className="font-medium text-slate-500 hover:text-brand">
              Analysis
            </Link>
            <ThemeToggle />
            <UserMenu username={viewerUsername} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        {error && (
          <>
            <p className="text-red-600">{error}</p>
            <Link href="/analysis" className="btn-ghost mt-4">
              Back
            </Link>
          </>
        )}
        {!error && !data && <p className="text-slate-400">Loading...</p>}
        {data && (
          <>
            <section className="card flex items-center gap-5 p-6">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-brand text-2xl font-bold text-white">
                {data.username.charAt(0).toUpperCase()}
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">{data.username}</h1>
                <p className="mt-1 text-sm text-slate-500">Member since {fmtDate(data.createdAt)}</p>
              </div>
            </section>

            {Object.keys(data.socialLinks).length > 0 && (
              <section className="card mt-6 p-6">
                <p className="text-sm font-semibold text-slate-700">Links</p>
                <div className="mt-3 flex flex-wrap gap-3">
                  {Object.entries(data.socialLinks).map(([key, url]) => (
                    <a
                      key={key}
                      href={url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="btn-ghost"
                    >
                      {SOCIAL_ICONS[key] || key}
                    </a>
                  ))}
                </div>
              </section>
            )}

            <section className="card mt-6 p-6">
              <p className="text-sm font-semibold text-slate-700">Best scores</p>
              {Object.keys(data.sections).length === 0 ? (
                <p className="mt-2 text-sm text-slate-400">No submitted mocks yet.</p>
              ) : (
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {Object.entries(data.sections).map(([section, info]) => (
                    <div key={section} className="rounded-lg border border-slate-200 p-4">
                      <p className="text-xs uppercase tracking-wide text-slate-400">{SECTION_NAMES[section] || section}</p>
                      {info ? (
                        <>
                          <p className="mt-1 text-2xl font-bold text-slate-900">{info.bestScore} marks</p>
                          <p className="text-xs text-slate-500">
                            {info.percentile.toFixed(1)}th percentile of {info.population} attempts
                          </p>
                        </>
                      ) : (
                        <p className="mt-1 text-sm text-slate-400">Not enough data yet</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

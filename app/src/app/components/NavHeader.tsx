"use client";

import Link from "next/link";
import ThemeToggle from "./ThemeToggle";
import UserMenu from "./UserMenu";

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/analysis", label: "Analysis" },
  { href: "/revise", label: "Revise" },
] as const;

/** The one nav bar used across every signed-in page (Dashboard, Analysis,
 * Revise, Profile, public profiles). Single source of truth so the link
 * set, active-state styling, and account menu never drift page to page. */
export default function NavHeader({
  active,
  username,
  role,
  maxWidth = "max-w-5xl",
}: {
  /** Pathname of the current page, e.g. "/analysis" - highlights that link.
   * Pass "" (or an unmatched value) on pages with no nav item of their own,
   * like a public profile. */
  active: string;
  username: string;
  role?: string;
  /** A literal Tailwind max-width class, e.g. "max-w-3xl" - kept literal in
   * call sites so Tailwind's content scanner picks it up. */
  maxWidth?: string;
}) {
  return (
    <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className={`mx-auto flex ${maxWidth} items-center gap-8 px-6 py-3.5`}>
        <Link href="/dashboard" className="display-type shrink-0 text-base font-semibold tracking-tight text-brand">
          CAT practice
        </Link>
        <span className="h-4 w-px shrink-0 bg-slate-300" />
        <nav className="flex flex-1 gap-1">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={
                "rounded-sm px-3.5 py-1.5 text-sm font-medium transition-colors " +
                (active === l.href ? "bg-brand text-white" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900")
              }
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-3">
          <ThemeToggle />
          <span className="h-4 w-px bg-slate-300" />
          <UserMenu username={username} role={role} />
        </div>
      </div>
    </header>
  );
}

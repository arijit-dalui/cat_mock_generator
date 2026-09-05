"use client";

import Link from "next/link";
import ThemeToggle from "./ThemeToggle";
import UserMenu from "./UserMenu";

const NAV_LINKS = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/questions", label: "Question sets" },
  { href: "/admin/pool", label: "Pool health" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/reports", label: "Reports" },
] as const;

/** The one nav bar for every admin page - same shell/design as the public
 * NavHeader (warm editorial theme, dark mode), just with the admin link
 * set and an "ADMIN" pill instead of the site logo doing double duty. */
export default function AdminNavHeader({ active, username }: { active: string; username: string }) {
  return (
    <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-8 px-6 py-3.5">
        <Link href="/admin" className="display-type shrink-0 text-base font-semibold tracking-tight text-brand">
          CAT practice
        </Link>
        <span className="rounded-full bg-brand/10 px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-brand">
          Admin
        </span>
        <span className="h-4 w-px shrink-0 bg-slate-300" />
        <nav className="flex flex-1 flex-wrap gap-1">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={
                "rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors " +
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
          <UserMenu username={username} role="admin" />
        </div>
      </div>
    </header>
  );
}

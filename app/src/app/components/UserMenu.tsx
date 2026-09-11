"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";

function UserIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

/** Avatar with a hover menu: name/role, a link to the full profile, and
 * sign-out - keeps the header itself down to nav + this one control. */
export default function UserMenu({ username, role }: { username: string; role?: string }) {
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="group relative">
      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-sm font-bold text-white"
        aria-label="Account menu"
      >
        {username.charAt(0).toUpperCase()}
      </button>
      {/* pt-2 keeps this wrapper (and so the hover state) unbroken across
       * the visual gap between the avatar and the panel below it. */}
      <div className="invisible absolute right-0 top-full z-20 pt-2 opacity-0 transition group-hover:visible group-hover:opacity-100">
        <div className="card w-56 p-3">
          <p className="truncate text-sm font-semibold text-slate-900">{username}</p>
          {role && <p className="text-xs uppercase tracking-wide text-slate-400">{role}</p>}
          <Link
            href="/profile"
            className="mt-2 flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            <UserIcon /> Profile
          </Link>
          <button
            onClick={logout}
            className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-red-600 hover:bg-red-50"
          >
            <LogoutIcon /> Log out
          </button>
        </div>
      </div>
    </div>
  );
}

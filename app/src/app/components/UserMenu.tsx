"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";

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
            className="mt-2 block rounded-lg px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            Profile
          </Link>
          <button
            onClick={logout}
            className="mt-1 block w-full rounded-lg px-2 py-1.5 text-left text-sm text-red-600 hover:bg-red-50"
          >
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}

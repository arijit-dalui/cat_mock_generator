"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AdminNavHeader from "../../components/AdminNavHeader";

interface UserRow {
  id: number;
  username: string;
  role: string;
  createdAt: string;
}

function fmtDate(s: string): string {
  const d = new Date(/T/.test(s) ? s : s.replace(" ", "T") + "Z");
  return isNaN(d.getTime()) ? s : d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export default function UsersClient({ username }: { username: string }) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [error, setError] = useState("");
  const [resetFor, setResetFor] = useState<UserRow | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetError, setResetError] = useState("");
  const [resetting, setResetting] = useState(false);
  const [resetDone, setResetDone] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/users");
        const d = await res.json();
        if (!res.ok) {
          setError(d.error || "Failed to load users.");
          return;
        }
        setUsers(d.users);
      } catch {
        setError("Network error.");
      }
    })();
  }, []);

  function openReset(u: UserRow) {
    setResetFor(u);
    setNewPassword("");
    setResetError("");
  }

  async function doReset() {
    if (!resetFor) return;
    setResetting(true);
    setResetError("");
    try {
      const res = await fetch(`/api/admin/users/${resetFor.id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword }),
      });
      const d = await res.json();
      if (!res.ok) {
        setResetError(d.error || "Could not reset password.");
        return;
      }
      setResetDone(resetFor.username);
      setResetFor(null);
      setTimeout(() => setResetDone(null), 4000);
    } catch {
      setResetError("Network error.");
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="app-shell min-h-screen">
      <AdminNavHeader active="/admin/users" username={username} />

      <main className="mx-auto max-w-4xl px-6 py-8">
        <h1 className="text-2xl font-bold text-slate-900">Users</h1>
        {resetDone && (
          <p className="mt-3 rounded-lg bg-green-50 px-4 py-2 text-sm text-green-700">
            Password reset for &quot;{resetDone}&quot;. Tell them their new password directly - there&apos;s no email to notify them.
          </p>
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="card mt-6 overflow-x-auto p-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-400">
                <th className="py-2">Username</th>
                <th>Role</th>
                <th>Joined</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-slate-100">
                  <td className="py-2 pr-3 font-medium text-slate-700">
                    <Link href={`/u/${encodeURIComponent(u.username)}`} className="hover:text-brand">
                      {u.username}
                    </Link>
                  </td>
                  <td className="pr-3 text-slate-500">{u.role}</td>
                  <td className="pr-3 text-slate-500">{fmtDate(u.createdAt)}</td>
                  <td>
                    <button onClick={() => openReset(u)} className="btn-ghost">
                      Reset password
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>

      {resetFor && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 px-4">
          <div className="card w-full max-w-sm p-6">
            <p className="font-semibold text-slate-900">Reset password for &quot;{resetFor.username}&quot;</p>
            <p className="mt-1 text-sm text-slate-500">They&apos;ll need to be told this new password out of band.</p>
            <input
              type="text"
              className="input mt-4"
              placeholder="New password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoFocus
            />
            {resetError && <p className="mt-2 text-sm text-red-600">{resetError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setResetFor(null)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={doReset} disabled={resetting || !newPassword}>
                {resetting ? "Resetting..." : "Reset"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

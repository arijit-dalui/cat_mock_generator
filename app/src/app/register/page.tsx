"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ThemeToggle from "../components/ThemeToggle";

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Registration failed.");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-shell min-h-screen px-6 py-6">
      <div className="mx-auto flex max-w-md justify-end"><ThemeToggle /></div>
      <div className="mx-auto flex min-h-[calc(100dvh-6rem)] max-w-md flex-col justify-center">
      <div className="card p-8 sm:p-10">
        <p className="pill">Start your practice log</p>
        <h1 className="display-type mt-3 text-4xl font-bold text-slate-900">Create your account</h1>
        <p className="mt-1 text-sm text-slate-500">
          Pick a unique username to start practising.
        </p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <label className="label">Username</label>
            <input
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </div>
          <div>
            <label className="label">Password</label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? "Creating..." : "Create account"}
          </button>
        </form>
        <p className="mt-4 text-sm text-slate-500">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-brand">
            Log in
          </Link>
        </p>
        <p className="mt-2 text-xs text-slate-400">
          By creating an account you agree to the{" "}
          <Link href="/terms" className="text-brand hover:underline">Terms</Link>{" "}
          and{" "}
          <Link href="/privacy" className="text-brand hover:underline">Privacy Policy</Link>.
        </p>
      </div>
      </div>
    </main>
  );
}

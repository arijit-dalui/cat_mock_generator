import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 text-center">
      <h1 className="text-4xl font-bold tracking-tight text-slate-900">
        CAT Mock Generator
      </h1>
      <p className="mt-3 max-w-xl text-slate-600">
        Generate fresh, CAT 99-percentile-style VA, RC, DI, LR and QA
        problem sets on demand. Every set ships with worked solutions
        and per-option explanations, and is gated by an independent
        AI judge so weak questions never reach you.
      </p>
      <div className="mt-8 flex gap-3">
        <Link href="/register" className="btn-primary">
          Create an account
        </Link>
        <Link href="/login" className="btn-ghost">
          Log in
        </Link>
      </div>
      <p className="mt-10 text-xs text-slate-400">
        Practice across VA, RC, DI, LR and QA. Generate new sets any time.
      </p>
    </main>
  );
}

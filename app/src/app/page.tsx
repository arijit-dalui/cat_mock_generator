import Link from "next/link";
import ThemeToggle from "./components/ThemeToggle";

export default function HomePage() {
  return (
    <main className="app-shell min-h-screen px-6 py-6">
      <nav className="mx-auto flex max-w-6xl items-center justify-between">
        <span className="display-type text-xl font-bold text-slate-900">CAT practice</span>
        <ThemeToggle />
      </nav>
      <section className="mx-auto flex min-h-[calc(100dvh-6rem)] max-w-4xl flex-col justify-center py-16">
        <p className="pill">Deliberate practice for CAT</p>
        <h1 className="display-type mt-4 max-w-3xl text-5xl font-bold leading-[0.96] text-slate-900 sm:text-7xl">
          Make every practice session count.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
          Work through CAT-style verbal, reading, data, logic and quantitative sets—with clear solutions when you are done.
        </p>
        <div className="mt-9 flex flex-wrap gap-3">
          <Link href="/register" className="btn-primary px-5 py-3">Start practising</Link>
          <Link href="/login" className="btn-ghost px-5 py-3">Log in</Link>
        </div>
        <div className="mt-14 grid max-w-2xl grid-cols-3 gap-3 text-left text-sm text-slate-600">
          <div className="border-t border-slate-300 pt-3"><strong className="block text-slate-900">Five skills</strong>VA, RC, DI, LR, QA</div>
          <div className="border-t border-slate-300 pt-3"><strong className="block text-slate-900">Review deeply</strong>Solutions and explanations</div>
          <div className="border-t border-slate-300 pt-3"><strong className="block text-slate-900">Track progress</strong>See your work over time</div>
        </div>
      </section>
    </main>
  );
}

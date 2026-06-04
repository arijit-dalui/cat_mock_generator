import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { attempts, externalStats } from "@/lib/db";
import { SECTIONS } from "@/lib/config";

export const dynamic = "force-dynamic";

/** The signed-in user's practice stats: per-section totals from their attempts
 * inside the app, plus their self-reported "other sources" numbers. */
export async function GET() {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const [appRows, extRows] = await Promise.all([
    attempts.statsByUser(user.id),
    externalStats.list(user.id),
  ]);

  const app: Record<string, { attempts: number; solved: number; correct: number }> = {};
  const external: Record<string, { solved: number; accuracy: number | null }> = {};
  for (const s of SECTIONS) {
    app[s] = { attempts: 0, solved: 0, correct: 0 };
    external[s] = { solved: 0, accuracy: null };
  }
  for (const r of appRows) {
    if (app[r.section]) {
      app[r.section] = {
        attempts: Number(r.attempts),
        solved: Number(r.solved),
        correct: Number(r.correct),
      };
    }
  }
  for (const r of extRows) {
    if (external[r.section]) {
      external[r.section] = {
        solved: Number(r.solved),
        accuracy: r.accuracy == null ? null : Number(r.accuracy),
      };
    }
  }

  return NextResponse.json({ app, external });
}

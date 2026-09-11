import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { currentUser } from "@/lib/auth";
import { mocks } from "@/lib/db";

export const dynamic = "force-dynamic";

interface Pack {
  title: string;
  questions: number;
  sections: string[];
}

/** Display titles are generic (no source branding). */
function packTitle(source: string, title: string): string {
  const m = title.match(/^Mock CAT - (\d+)$/);
  if (source === "MockCAT" && m) return `Full Mock ${m[1]}`;
  if (source === "Percentyl") return "Full Mock P1";
  return title;
}

/** Banked full-mock content on disk (raw pulls), summarized for the admin. */
async function bankPacks(): Promise<Pack[]> {
  const packs: Pack[] = [];
  const workDir = path.resolve(process.cwd(), "..", "work");
  // MockCAT mocks from the pulled domain inventory.
  try {
    const dom = JSON.parse(
      await fs.readFile(path.join(workDir, "mockat_raw", "domain_mock-cats.json"), "utf-8"),
    );
    const list = Array.isArray(dom) ? dom : [];
    for (const cat of list) {
      for (const q of cat?.quizzes ?? []) {
        if (q?.isPremium || q?.hasAccess === false) continue;
        packs.push({
          title: packTitle("MockCAT", q?.name ?? `Mock ${q?.id}`),
          questions: q?.totalNumberOfQuestions ?? q?.totalQuestions ?? 0,
          sections: ["VA", "RC", "DI", "LR", "QA"],
        });
      }
    }
  } catch {
    /* bank not present (e.g. cloud deploy) - skip */
  }
  // Percentyl full mock.
  try {
    const m = JSON.parse(
      await fs.readFile(path.join(workDir, "pct_raw", "mock", "mock_1.json"), "utf-8"),
    );
    const secs = m?.reveal?.sections ?? {};
    const n = Object.values(secs).reduce(
      (t: number, s) => t + ((s as { questions?: unknown[] })?.questions?.length ?? 0),
      0,
    );
    if (n > 0) {
      packs.push({ title: packTitle("Percentyl", "x"), questions: n, sections: ["VA", "RC", "DI", "LR", "QA"] });
    }
  } catch {
    /* skip */
  }
  return packs;
}

/** Admin-only: newest-first full mocks with owner + per-section attempts,
 * plus the banked full-mock content available in the pool. */
export async function GET() {
  const user = await currentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }
  const rows = await mocks.listDetailed(50);
  return NextResponse.json({ mocks: rows, packs: await bankPacks() });
}

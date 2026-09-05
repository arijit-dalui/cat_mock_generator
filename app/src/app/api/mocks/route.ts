import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { mocks, events } from "@/lib/db";
import { serveSectionAttempt } from "@/lib/generate/serveAttempt";
import type { Section } from "@/lib/config";
import { checkRateLimit, tooManyRequests } from "@/lib/rateLimit";

// Five sequential generations (some of which may hit the LLM) - generous
// but bounded, matching /api/generate's own ceiling per section.
export const maxDuration = 300;

/** VARC and DILR bundle two sections into one timed phase, matching the
 * real CAT structure; QA is solo. Order matters - it's the sitting order. */
const PHASES: { phase: "VARC" | "DILR" | "QA"; sections: Section[] }[] = [
  { phase: "VARC", sections: ["VA", "RC"] },
  { phase: "DILR", sections: ["DI", "LR"] },
  { phase: "QA", sections: ["QA"] },
];

export async function GET() {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const rows = await mocks.listForUser(user.id);
  return NextResponse.json({
    mocks: rows.map((m) => ({ id: m.id, submitted: !!m.submitted, createdAt: m.created_at })),
  });
}

/** Creates a full mock: one `mocks` row plus five section attempts (VA, RC,
 * DI, LR, QA), each tagged with which phase it belongs to. Reuses the exact
 * same pool/generate/judge path as a single sectional - a mock is just five
 * of those, bundled. */
export async function POST() {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const rl = checkRateLimit(`mocks:${user.id}`, 3, 5 * 60_000);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterSec);

  const mockId = await mocks.create(user.id);
  try {
    for (const { phase, sections } of PHASES) {
      for (const section of sections) {
        await serveSectionAttempt(user.id, section, { mockId, phase });
      }
    }
  } catch (e) {
    // Partial mocks are useless - remove() cascades to whatever attempts
    // did generate successfully before the failure.
    await mocks.remove(mockId);
    return NextResponse.json(
      { error: "Could not build the mock. " + (e instanceof Error ? e.message : "") },
      { status: 502 },
    );
  }

  await events.log("generate", user.id, "MOCK");
  return NextResponse.json({ mockId });
}

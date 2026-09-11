import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { users, attempts } from "@/lib/db";

/** Public profile data: username, join date, self-entered social links,
 * and best score/percentile per section (all from real submitted
 * attempts). Requires being signed in (this app has no public/anonymous
 * pages) but does not require being the profile's owner. */
export async function GET(_req: Request, { params }: { params: { username: string } }) {
  const viewer = await currentUser();
  if (!viewer) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const user = await users.byUsername(params.username);
  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  const best = await attempts.bestScoresByUser(user.id);
  const sections: Record<string, { bestScore: number; percentile: number; population: number } | null> = {};
  for (const row of best) {
    const p = await attempts.percentile(row.section, row.best_score);
    sections[row.section] = p ? { bestScore: row.best_score, ...p } : null;
  }

  let socialLinks: Record<string, string> = {};
  if (user.social_links) {
    try {
      socialLinks = JSON.parse(user.social_links);
    } catch {
      /* corrupt/legacy value - show none rather than fail the page */
    }
  }

  return NextResponse.json({
    username: user.username,
    createdAt: user.created_at,
    socialLinks,
    sections,
  });
}

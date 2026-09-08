import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { users } from "@/lib/db";
import { SECTIONS, type Section } from "@/lib/config";

export const dynamic = "force-dynamic";

/** Top 10 by best raw_score in a section - real submitted attempts only. */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const url = new URL(req.url);
  if (url.searchParams.get("scope") === "mock") {
    const rows = await users.mockLeaderboard(10);
    return NextResponse.json({ leaderboard: rows });
  }
  const section = url.searchParams.get("section") as Section | null;
  if (!section || !SECTIONS.includes(section)) {
    return NextResponse.json({ error: "Unknown section." }, { status: 400 });
  }
  const rows = await users.leaderboard(section, 10);
  return NextResponse.json({ leaderboard: rows });
}

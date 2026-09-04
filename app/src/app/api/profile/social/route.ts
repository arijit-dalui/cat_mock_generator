import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { users } from "@/lib/db";

const ALLOWED_KEYS = ["reddit", "instagram", "twitter", "linkedin"] as const;

/** Self-entered profile links - the user types their own URL in, shown on
 * their public profile. Never an OAuth "connect" flow; there's nothing to
 * authenticate against, so this just validates and stores what they typed. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const links: Record<string, string> = {};
  for (const key of ALLOWED_KEYS) {
    const raw = body[key];
    if (typeof raw !== "string" || raw.trim() === "") continue;
    const value = raw.trim();
    if (!/^https?:\/\/.+/i.test(value)) {
      return NextResponse.json({ error: `${key} must be a full http(s) URL.` }, { status: 400 });
    }
    links[key] = value;
  }
  await users.updateSocialLinks(user.id, links);
  return NextResponse.json({ ok: true, socialLinks: links });
}

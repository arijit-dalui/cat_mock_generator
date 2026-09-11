import { NextResponse } from "next/server";
import { currentUser, hashPassword, verifyPassword, validatePassword } from "@/lib/auth";
import { users } from "@/lib/db";

/** Self-service password change - requires knowing the current password.
 * (The admin-mediated reset at /api/admin/users/[id]/reset-password is for
 * when a user has forgotten it entirely and can't prove that.) */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  let body: { currentPassword?: unknown; newPassword?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (typeof body.currentPassword !== "string" || !verifyPassword(body.currentPassword, user.password_hash)) {
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
  }
  const err = validatePassword(body.newPassword);
  if (err) {
    return NextResponse.json({ error: err }, { status: 400 });
  }
  await users.updatePassword(user.id, hashPassword(body.newPassword as string));
  return NextResponse.json({ ok: true });
}

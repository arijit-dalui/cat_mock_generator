import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { users } from "@/lib/db";
import { hashPassword, validatePassword } from "@/lib/auth";

/** Admin-mediated password reset. There's no email/SMTP in this app, so a
 * self-service "forgot password" flow can't verify identity - an admin
 * sets the new password directly and tells the user out of band. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const admin = await currentUser();
  if (!admin) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  if (admin.role !== "admin") {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }
  const target = await users.byId(Number(params.id));
  if (!target) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }
  let body: { newPassword?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const err = validatePassword(body.newPassword);
  if (err) {
    return NextResponse.json({ error: err }, { status: 400 });
  }
  await users.updatePassword(target.id, hashPassword(body.newPassword as string));
  return NextResponse.json({ ok: true });
}

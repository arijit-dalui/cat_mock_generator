import { NextResponse } from "next/server";
import { users, events } from "@/lib/db";
import {
  hashPassword,
  startSession,
  validateUsername,
  validatePassword,
} from "@/lib/auth";

export async function POST(req: Request) {
  let body: { username?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const username =
    typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  const ue = validateUsername(username);
  if (ue) return NextResponse.json({ error: ue }, { status: 400 });
  const pe = validatePassword(password);
  if (pe) return NextResponse.json({ error: pe }, { status: 400 });

  if (users.byUsername(username)) {
    return NextResponse.json(
      { error: "That username is already taken." },
      { status: 409 },
    );
  }

  const user = users.create(username, hashPassword(password), "user");
  startSession(user.id);
  events.log("register", user.id);
  events.log("login", user.id);

  return NextResponse.json({
    ok: true,
    user: { id: user.id, username: user.username, role: user.role },
  });
}

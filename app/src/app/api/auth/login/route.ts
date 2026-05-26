import { NextResponse } from "next/server";
import { users, events } from "@/lib/db";
import { verifyPassword, startSession } from "@/lib/auth";

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

  if (!username || !password) {
    return NextResponse.json(
      { error: "Enter your username and password." },
      { status: 400 },
    );
  }

  const user = users.byUsername(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return NextResponse.json(
      { error: "Incorrect username or password." },
      { status: 401 },
    );
  }

  startSession(user.id);
  events.log("login", user.id);

  return NextResponse.json({
    ok: true,
    user: { id: user.id, username: user.username, role: user.role },
  });
}

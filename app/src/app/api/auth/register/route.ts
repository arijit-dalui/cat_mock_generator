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

  try {
    if (await users.byUsername(username)) {
      return NextResponse.json(
        { error: "That username is already taken." },
        { status: 409 },
      );
    }

    const user = await users.create(username, hashPassword(password), "user");
    await startSession(user.id);
    await events.log("register", user.id);
    await events.log("login", user.id);

    return NextResponse.json({
      ok: true,
      user: { id: user.id, username: user.username, role: user.role },
    });
  } catch (e) {
    console.error("[register] failed:", e);
    return NextResponse.json(
      {
        error:
          "Registration failed: " +
          (e instanceof Error ? e.message : String(e)),
      },
      { status: 500 },
    );
  }
}

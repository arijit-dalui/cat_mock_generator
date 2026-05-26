/**
 * Authentication helpers: password hashing, database-backed sessions,
 * and the current-user lookup used by pages and API routes.
 */
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { cookies } from "next/headers";
import { config } from "./config";
import { users, sessions, type User } from "./db";

const COOKIE = "cat_session";

/** SQLite-friendly timestamp: "YYYY-MM-DD HH:MM:SS" in UTC. */
function sqlTime(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 12);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

/** Create a session row and set the session cookie. */
export function startSession(userId: number): void {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + config.sessionTtlDays * 86400_000);
  sessions.create(token, userId, sqlTime(expires));
  cookies().set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires,
  });
}

/** Destroy the current session and clear the cookie. */
export function endSession(): void {
  const c = cookies().get(COOKIE);
  if (c) sessions.destroy(c.value);
  cookies().delete(COOKIE);
}

/** Resolve the logged-in user from the session cookie, or null. */
export function currentUser(): User | null {
  const c = cookies().get(COOKIE);
  if (!c) return null;
  const s = sessions.get(c.value);
  if (!s) return null;
  if (new Date(s.expires_at.replace(" ", "T") + "Z") < new Date()) {
    sessions.destroy(c.value);
    return null;
  }
  return users.byId(s.user_id) ?? null;
}

/** Username rules: 3-30 chars, letters/digits and @ . _ - only. */
export function validateUsername(name: unknown): string | null {
  if (typeof name !== "string") return "Username is required.";
  const n = name.trim();
  if (n.length < 3 || n.length > 30)
    return "Username must be 3-30 characters.";
  if (!/^[A-Za-z0-9@._-]+$/.test(n))
    return "Username may use letters, digits and @ . _ - only.";
  return null;
}

export function validatePassword(pw: unknown): string | null {
  if (typeof pw !== "string") return "Password is required.";
  if (pw.length < 6) return "Password must be at least 6 characters.";
  if (pw.length > 200) return "Password is too long.";
  return null;
}

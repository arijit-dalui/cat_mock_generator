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

/** ISO timestamp safe for both SQLite and Postgres. */
function sqlTime(d: Date): string {
  return d.toISOString();
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 12);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

/** Create a session row and set the session cookie. */
export async function startSession(userId: number): Promise<void> {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + config.sessionTtlDays * 86400_000);
  await sessions.create(token, userId, sqlTime(expires));
  cookies().set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires,
  });
}

/** Destroy the current session and clear the cookie. */
export async function endSession(): Promise<void> {
  const c = cookies().get(COOKIE);
  if (c) await sessions.destroy(c.value);
  cookies().delete(COOKIE);
}

/** Resolve the logged-in user from the session cookie, or null. */
export async function currentUser(): Promise<User | null> {
  const c = cookies().get(COOKIE);
  if (!c) return null;
  const s = await sessions.get(c.value);
  if (!s) return null;
  // expires_at may arrive as "YYYY-MM-DD HH:MM:SS" (sqlite) or ISO (postgres).
  const exp = new Date(/T/.test(s.expires_at) ? s.expires_at : s.expires_at.replace(" ", "T") + "Z");
  if (exp < new Date()) {
    await sessions.destroy(c.value);
    return null;
  }
  return (await users.byId(s.user_id)) ?? null;
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

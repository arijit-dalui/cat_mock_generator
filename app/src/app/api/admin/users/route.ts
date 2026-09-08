import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { users } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await currentUser();
  if (!admin) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  if (admin.role !== "admin") {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }
  const rows = await users.listAll();
  return NextResponse.json({
    users: rows.map((u) => ({ id: u.id, username: u.username, role: u.role, createdAt: u.created_at })),
  });
}

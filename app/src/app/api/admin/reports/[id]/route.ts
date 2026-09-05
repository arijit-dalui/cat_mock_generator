import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { questionReports } from "@/lib/db";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const admin = await currentUser();
  if (!admin) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  if (admin.role !== "admin") {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }
  await questionReports.resolve(Number(params.id));
  return NextResponse.json({ ok: true });
}

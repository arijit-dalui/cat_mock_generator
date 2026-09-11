import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { questionReports } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await currentUser();
  if (!admin) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  if (admin.role !== "admin") {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }
  const rows = await questionReports.listOpen();
  return NextResponse.json({
    reports: rows.map((r) => ({
      id: r.id,
      attemptId: r.attempt_id,
      setId: r.set_id,
      questionId: r.question_id,
      section: r.section,
      promptSnapshot: r.prompt_snapshot,
      reason: r.reason,
      createdAt: r.created_at,
    })),
  });
}

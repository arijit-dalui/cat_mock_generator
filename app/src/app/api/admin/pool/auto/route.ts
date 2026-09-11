import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { autoLoopStatus, startAutoLoop, stopAutoLoop } from "@/lib/generate/autoLoop";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const user = await currentUser();
  if (!user || user.role !== "admin") return null;
  return user;
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }
  return NextResponse.json(autoLoopStatus());
}

/** Start/stop the in-process auto-generation loop. Body: {action: "start"|"stop"} */
export async function POST(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as { action?: unknown } | null;
  if (body?.action === "start") startAutoLoop();
  else if (body?.action === "stop") stopAutoLoop();
  else return NextResponse.json({ error: "action must be 'start' or 'stop'." }, { status: 400 });
  return NextResponse.json(autoLoopStatus());
}

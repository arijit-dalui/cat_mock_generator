import { NextResponse } from "next/server";
import { endSession } from "@/lib/auth";

export async function POST() {
  endSession();
  return NextResponse.json({ ok: true });
}

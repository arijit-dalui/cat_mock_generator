import { NextResponse } from "next/server";
import { config, SECTIONS, QA_TOPICS, type Section, type QaTopic } from "@/lib/config";
import { generateOneForPool } from "@/lib/generate/pool";

/**
 * Worker-only endpoint: generate ONE set for the given section and add it to
 * the pool (judge-gated - see generateOneForPool). Authenticated with the
 * shared WORKER_TOKEN.
 */
export async function POST(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (auth !== `Bearer ${config.workerToken}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const url = new URL(req.url);
  const section = url.searchParams.get("section") as Section | null;
  if (!section || !SECTIONS.includes(section)) {
    return NextResponse.json({ error: "Bad section." }, { status: 400 });
  }
  const topicParam = (url.searchParams.get("topic") || "").toLowerCase();
  let topic: QaTopic | undefined;
  if (topicParam) {
    if (section !== "QA" || !(QA_TOPICS as readonly string[]).includes(topicParam)) {
      return NextResponse.json({ error: "Bad topic (QA drills only)." }, { status: 400 });
    }
    topic = topicParam as QaTopic;
  }

  const result = await generateOneForPool(section, "worker", { debug: true, topic });
  if (!result.accepted) {
    return NextResponse.json({
      rejected: true,
      section,
      ...(topic ? { topic } : {}),
      score: result.score,
      notes: result.notes,
      warnings: result.warnings,
    });
  }
  return NextResponse.json({
    id: result.id,
    section,
    ...(topic ? { topic } : {}),
    score: result.score,
    warnings: result.warnings,
  });
}

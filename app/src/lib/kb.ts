/**
 * Knowledge-base retrieval. The generation engine pulls exemplars from here
 * as style references, and uses the similarity check to make sure a freshly
 * generated item is not too close to a real mock question.
 *
 * Driver-agnostic: uses query() from db.ts which dispatches to SQLite or
 * Postgres depending on DATABASE_URL.
 */
import { query } from "./db";
import { textSimilarity } from "./llm";

const usingPostgres = !!process.env.DATABASE_URL;
const RAND = usingPostgres ? "random()" : "RANDOM()";
const PLACE = usingPostgres
  ? (i: number) => `$${i}`
  : (_i: number) => "?";

export interface KbItem {
  id: number;
  section: string;
  subtype: string | null;
  source_file: string | null;
  stem: string;
  options: string | null;
  answer: string | null;
  solution: string | null;
  word_count: number | null;
}

/** Random exemplars for a section (optionally a specific subtype). */
export async function sampleExemplars(
  section: string,
  opts: { subtype?: string; limit?: number; minWords?: number; maxWords?: number } = {},
): Promise<KbItem[]> {
  const limit = opts.limit ?? 5;
  const where: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  where.push(`section = ${PLACE(i++)}`); params.push(section);
  if (opts.subtype) { where.push(`subtype = ${PLACE(i++)}`); params.push(opts.subtype); }
  if (opts.minWords != null) { where.push(`word_count >= ${PLACE(i++)}`); params.push(opts.minWords); }
  if (opts.maxWords != null) { where.push(`word_count <= ${PLACE(i++)}`); params.push(opts.maxWords); }
  const sql = `SELECT * FROM kb_items WHERE ${where.join(" AND ")} ORDER BY ${RAND} LIMIT ${PLACE(i)}`;
  params.push(limit);
  return query<KbItem>(sql, params);
}

/** Spread a sample across several subtypes (used for the mixed VA/QA sets). */
export async function sampleAcrossSubtypes(
  section: string,
  subtypes: string[],
  perSubtype: number,
): Promise<KbItem[]> {
  const out: KbItem[] = [];
  for (const st of subtypes) {
    out.push(...(await sampleExemplars(section, { subtype: st, limit: perSubtype })));
  }
  return out;
}

export async function subtypeCounts(section: string): Promise<Record<string, number>> {
  const rows = await query<{ subtype: string; c: number }>(
    `SELECT subtype, COUNT(*) c FROM kb_items WHERE section = ${PLACE(1)} GROUP BY subtype`,
    [section],
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.subtype] = Number(r.c);
  return out;
}

/**
 * Highest word-overlap similarity between `text` and a random sample of real
 * mock items in the section. Used as an anti-plagiarism guard - a generated
 * item scoring above ~0.6 is too close to a source question.
 */
export async function maxSimilarityToKb(
  text: string,
  section: string,
  sampleSize = 400,
): Promise<number> {
  const rows = await query<{ stem: string }>(
    `SELECT stem FROM kb_items WHERE section = ${PLACE(1)} ORDER BY ${RAND} LIMIT ${PLACE(2)}`,
    [section, sampleSize],
  );
  let max = 0;
  for (const r of rows) {
    const s = textSimilarity(text, r.stem);
    if (s > max) max = s;
  }
  return max;
}

export const LEAK_THRESHOLD = 0.6;

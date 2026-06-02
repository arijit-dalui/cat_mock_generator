/**
 * Fetches a random Aeon essay to use as fresh reading-comprehension source
 * material. Aeon publishes long-form essays well suited to CAT-style RC.
 * Any failure returns null so the RC generator can fall back to a mock passage.
 */

const LISTING = "https://aeon.co/essays";
const UA = "Mozilla/5.0 (compatible; CAT-Mock-Generator/1.0)";

async function get(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    // Tight per-request budget: Aeon is best-effort fresh source material, not
    // worth blocking generation on. A slow/blocking response falls through to
    // the KB exemplar and then the (reliable) LLM synth fallback.
    const t = setTimeout(() => ctrl.abort(), 6_000);
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** Strip HTML tags and decode the few entities that matter. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&mdash;/g, "-")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface AeonArticle {
  title: string;
  text: string;
  url: string;
}

/**
 * Returns a random Aeon essay trimmed to a CAT-appropriate length
 * (about `targetWords`, capped to whole paragraphs), or null on failure.
 */
export async function fetchAeonArticle(
  // ~500 words is both a realistic CAT RC length AND keeps rcPrompt's token
  // count low enough that prompt + max_tokens clears Groq's free-tier 6000 TPM
  // per-request cap (a 750-word passage pushed the request over the limit).
  targetWords = 500,
): Promise<AeonArticle | null> {
  const listing = await get(LISTING);
  if (!listing) return null;

  const slugs = Array.from(
    new Set(
      (listing.match(/\/essays\/[a-z0-9-]{8,}/gi) || []).map((s) =>
        s.toLowerCase(),
      ),
    ),
  );
  if (!slugs.length) return null;

  // try a couple of random essays until one yields a usable body
  for (let attempt = 0; attempt < 2 && slugs.length; attempt++) {
    const idx = Math.floor(Math.random() * slugs.length);
    const slug = slugs.splice(idx, 1)[0];
    const url = `https://aeon.co${slug}`;
    const html = await get(url);
    if (!html) continue;

    const titleM = html.match(/<title>([^<]+)<\/title>/i);
    const title = titleM ? stripHtml(titleM[1]).replace(/\s*\|\s*Aeon.*$/i, "") : "Aeon essay";

    const paras = (html.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || [])
      .map(stripHtml)
      .filter((p) => p.split(/\s+/).length >= 25); // real body paragraphs only

    if (paras.length < 3) continue;

    const chosen: string[] = [];
    let words = 0;
    for (const p of paras) {
      chosen.push(p);
      words += p.split(/\s+/).length;
      if (words >= targetWords) break;
    }
    if (words < 350) continue; // too short to be an RC passage

    return { title, text: chosen.join("\n\n"), url };
  }
  return null;
}

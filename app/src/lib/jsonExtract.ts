/** Pure JSON-from-messy-text extraction - no dependency on config/env, so it
 * can be unit-tested (and imported) without pulling in the LLM client. Split
 * out of llm.ts, which is the only caller. */

/** Escape raw control characters inside JSON string literals so JSON.parse
 * won't reject the payload. LLMs frequently emit literal newlines/tabs in
 * "context" / "prompt" / "solution" fields. */
function sanitiseJsonControlChars(src: string): string {
  let out = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const code = src.charCodeAt(i);
    if (inStr) {
      if (esc) {
        out += c;
        esc = false;
        continue;
      }
      if (c === "\\") {
        out += c;
        esc = true;
        continue;
      }
      if (c === '"') {
        out += c;
        inStr = false;
        continue;
      }
      if (code === 0x0a) {
        out += "\\n";
        continue;
      }
      if (code === 0x0d) {
        out += "\\r";
        continue;
      }
      if (code === 0x09) {
        out += "\\t";
        continue;
      }
      if (code < 0x20) {
        out += " ";
        continue;
      }
      out += c;
      continue;
    }
    if (c === '"') {
      inStr = true;
    }
    out += c;
  }
  return out;
}

/** Pull the first balanced JSON object/array out of an LLM response. */
export function extractJSON(text: string): unknown {
  let t = text.trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  const sObj = t.indexOf("{");
  const sArr = t.indexOf("[");
  const candidates = [sObj, sArr].filter((i) => i >= 0);
  if (!candidates.length) throw new Error("No JSON found in LLM response");
  const start = Math.min(...candidates);
  const open = t[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) {
        const slice = t.slice(start, i + 1);
        try {
          return JSON.parse(slice);
        } catch {
          // Retry after escaping raw control chars in string literals.
          return JSON.parse(sanitiseJsonControlChars(slice));
        }
      }
    }
  }
  throw new Error("Unbalanced JSON in LLM response");
}

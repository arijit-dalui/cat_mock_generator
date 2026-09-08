/** In-memory fixed-window rate limiter. No new dependency, no schema - good
 * enough for a single-process deployment (the worker/dev/typical small VPS
 * setup this app runs on). It does NOT share state across multiple server
 * instances/processes - upgrade to a DB or Redis-backed counter if this ever
 * runs behind a multi-instance load balancer. */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Buckets are tiny and self-expiring; sweep occasionally so a long-running
// process doesn't accumulate one entry per distinct IP/user forever.
let lastSweep = Date.now();
function sweep() {
  const now = Date.now();
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, b] of buckets) if (b.resetAt <= now) buckets.delete(key);
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the caller may try again. Only meaningful when !allowed. */
  retryAfterSec: number;
}

/** Fixed-window check: `limit` requests per `windowMs` per `key`. */
export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  sweep();
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }
  if (existing.count >= limit) {
    return { allowed: false, retryAfterSec: Math.ceil((existing.resetAt - now) / 1000) };
  }
  existing.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}

/** Best-effort client IP from standard proxy headers - Next.js doesn't
 * expose the socket address in a route handler, and this app is expected to
 * sit behind a reverse proxy (Vercel, nginx, etc.) that sets one of these. */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

/** A ready-to-return 429 Response for a rate-limited request. */
export function tooManyRequests(retryAfterSec: number): Response {
  return new Response(
    JSON.stringify({ error: `Too many requests. Try again in ${retryAfterSec}s.` }),
    {
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": String(retryAfterSec) },
    },
  );
}

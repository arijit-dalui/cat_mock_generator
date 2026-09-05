import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRateLimit } from "../src/lib/rateLimit.ts";

test("checkRateLimit: allows up to the limit, then blocks", () => {
  const key = `test-${Math.random()}`;
  for (let i = 0; i < 3; i++) {
    assert.equal(checkRateLimit(key, 3, 60_000).allowed, true, `request ${i + 1} should be allowed`);
  }
  const blocked = checkRateLimit(key, 3, 60_000);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSec > 0);
});

test("checkRateLimit: different keys don't share a bucket", () => {
  const a = `a-${Math.random()}`;
  const b = `b-${Math.random()}`;
  for (let i = 0; i < 5; i++) checkRateLimit(a, 1, 60_000);
  assert.equal(checkRateLimit(b, 1, 60_000).allowed, true);
});

test("checkRateLimit: resets after the window elapses", async () => {
  const key = `window-${Math.random()}`;
  assert.equal(checkRateLimit(key, 1, 50).allowed, true);
  assert.equal(checkRateLimit(key, 1, 50).allowed, false);
  await new Promise((r) => setTimeout(r, 70));
  assert.equal(checkRateLimit(key, 1, 50).allowed, true);
});

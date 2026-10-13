import test from "node:test";
import assert from "node:assert/strict";
import { validDay } from "../src/lib/valid-day";

const today = "2026-10-13";

test("validDay keeps a real YYYY-MM-DD date", () => {
  assert.equal(validDay("2026-10-14", today), "2026-10-14");
  assert.equal(validDay("2028-02-29", today), "2028-02-29");
});

test("validDay falls back for empty, missing, malformed or impossible dates", () => {
  for (const raw of [undefined, "", "2026-1-5", "2026-02-30", "2026-13-01", "abc", "2026-10-14 "]) {
    assert.equal(validDay(raw, today), today, String(raw));
  }
});

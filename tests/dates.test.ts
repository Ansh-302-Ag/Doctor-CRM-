import test from "node:test";
import assert from "node:assert/strict";
import { parseDay } from "../src/lib/agent/dates";

const TZ = "Asia/Kolkata";
const WED = new Date("2026-09-02T06:00:00+05:30");   // a Wednesday in IST

test("reads the phrasings a booking actually uses", () => {
  assert.equal(parseDay("today please", TZ, WED), "2026-09-02");
  assert.equal(parseDay("tomorrow", TZ, WED), "2026-09-03");
  assert.equal(parseDay("this Friday if possible", TZ, WED), "2026-09-04");
  assert.equal(parseDay("next Friday", TZ, WED), "2026-09-11");
  assert.equal(parseDay("2026-09-10", TZ, WED), "2026-09-10");
  assert.equal(parseDay("10/09", TZ, WED), "2026-09-10");
});

test("the same weekday name means next week, not today", () => {
  assert.equal(parseDay("wednesday", TZ, WED), "2026-09-09");
});

test("returns null rather than guessing", () => {
  for (const m of ["sometime soon", "whenever you have space", "after my usual time", ""])
    assert.equal(parseDay(m, TZ, WED), null, m);
});

/**
 * Hits the real Anthropic API. Skipped without ANTHROPIC_API_KEY so the rest of
 * the suite stays offline and deterministic.
 *
 *   ANTHROPIC_API_KEY=sk-... npm test
 *
 * These assert the classifier's contract, not exact wording: the right intent,
 * a real doctor or null, a resolved date, the offered slot they meant — and
 * null rather than a guess when the message does not say.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { classifyWithClaude, type ClassifyInput } from "../src/lib/agent/intent";

const live = { skip: process.env.ANTHROPIC_API_KEY ? false : "ANTHROPIC_API_KEY not set" };

const base: ClassifyInput = {
  doctors: ["Dr. Rao", "Dr. Iyer"],
  offered: ["Fri 4 Sept, 9:00 am", "Fri 4 Sept, 9:30 am", "Fri 4 Sept, 4:00 pm"],
  today: "2026-09-02",
  weekday: "Wednesday",
  step: null,
  body: "",
};
const ask = (body: string, over: Partial<ClassifyInput> = {}) =>
  classifyWithClaude({ ...base, ...over, body });

test("reads plain booking requests", live, async () => {
  const r = await ask("Hi, I'd like to see Dr. Rao this Friday");
  assert.equal(r.intent, "book");
  assert.equal(r.doctor, "Dr. Rao");
  assert.equal(r.day, "2026-09-04");
});

test("resolves relative dates against today", live, async () => {
  assert.equal((await ask("book me in tomorrow")).day, "2026-09-03");
  assert.equal((await ask("can I come next Monday")).day, "2026-09-07");
});

test("picks the offered slot the patient meant", live, async () => {
  assert.equal((await ask("4pm works")).slotIndex, 2);
  assert.equal((await ask("the first one please")).slotIndex, 0);
  assert.equal((await ask("9.30")).slotIndex, 1);
});

test("returns null rather than guessing", live, async () => {
  const vague = await ask("sometime soon would be good");
  assert.equal(vague.day, null);
  const ambiguous = await ask("whichever is fine");
  assert.equal(ambiguous.slotIndex, null, "must not pick a slot the patient did not choose");
});

test("never invents a doctor who does not work here", live, async () => {
  assert.equal((await ask("I want to see Dr. Sharma")).doctor, null);
});

test("separates the logistics intents", live, async () => {
  assert.equal((await ask("please cancel my visit")).intent, "cancel");
  assert.equal((await ask("can I move my appointment to Friday")).intent, "reschedule");
  assert.equal((await ask("when is my next appointment?")).intent, "check_appointment");
  assert.equal((await ask("what tablets am I on")).intent, "check_prescription_record");
  assert.equal((await ask("yes I agree")).intent, "consent_yes");
  assert.equal((await ask("please delete my details")).intent, "delete_my_data");
});

test("anything needing clinical judgement comes back unclear, never answered", live, async () => {
  // The screen catches these first in production; this is the second line of
  // defence, checking the model itself will not try to be helpful.
  for (const m of [
    "is 500mg too much for a child",
    "my throat still hurts after three days, what should I do",
    "can I drink alcohol on these",
  ]) assert.equal((await ask(m)).intent, "unclear", m);
});

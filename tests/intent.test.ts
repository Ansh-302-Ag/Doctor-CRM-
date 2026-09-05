/**
 * classifyWithClaude's handling of what comes back, with fetch stubbed.
 * The live model is covered in tests/intent.live.test.ts; this file covers the
 * responses a live test cannot reliably produce.
 */
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  classifyWithClaude, ClassifierUnavailable, type ClassifyInput,
} from "../src/lib/agent/intent";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; delete process.env.ANTHROPIC_API_KEY; });

const input: ClassifyInput = {
  body: "book me in", doctors: ["Dr. Rao", "Dr. Iyer"],
  offered: ["Fri 4 Sept, 9:00 am", "Fri 4 Sept, 9:30 am"],
  today: "2026-09-02", weekday: "Wednesday",
};

/** Reply with one tool_use block carrying exactly these fields. */
function stubFetch(toolInput: Record<string, unknown>, status = 200) {
  process.env.ANTHROPIC_API_KEY = "sk-test";
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ content: [{ type: "tool_use", name: "record_intent", input: toolInput }] }),
    { status, headers: { "content-type": "application/json" } },
  )) as typeof fetch;
}

test("a well-formed response passes through", async () => {
  stubFetch({ intent: "book", doctor: "Dr. Rao", day: "2026-09-04", slot_index: 1 });
  const r = await classifyWithClaude(input);
  assert.equal(r.intent, "book");
  assert.equal(r.doctor, "Dr. Rao");
  assert.equal(r.day, "2026-09-04");
  assert.equal(r.slotIndex, 1);
});

test("a doctor who does not work here becomes null", async () => {
  stubFetch({ intent: "book", doctor: "Dr. Sharma", day: null, slot_index: null });
  assert.equal((await classifyWithClaude(input)).doctor, null);
});

test("an impossible date becomes null rather than reaching the database", async () => {
  for (const day of ["2026-13-45", "2026-02-30", "0000-00-00", "tomorrow", "2026-9-4"]) {
    stubFetch({ intent: "book", doctor: null, day, slot_index: null });
    assert.equal((await classifyWithClaude(input)).day, null, day);
  }
});

test("an out-of-range or non-integer slot index becomes null", async () => {
  for (const slot_index of [-1, 2, 99, 1.5, "1", null]) {
    stubFetch({ intent: "book", doctor: null, day: null, slot_index });
    assert.equal((await classifyWithClaude(input)).slotIndex, null, String(slot_index));
  }
});

test("an intent outside the enum degrades to unclear, which escalates", async () => {
  for (const intent of ["answer_medical_question", "prescribe", "", null, 42]) {
    stubFetch({ intent, doctor: null, day: null, slot_index: null });
    assert.equal((await classifyWithClaude(input)).intent, "unclear", String(intent));
  }
});

test("a missing key, a non-200, junk JSON and no tool call all fail loudly", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  await assert.rejects(classifyWithClaude(input), ClassifierUnavailable);

  stubFetch({ intent: "book", doctor: null, day: null, slot_index: null }, 500);
  await assert.rejects(classifyWithClaude(input), ClassifierUnavailable);

  process.env.ANTHROPIC_API_KEY = "sk-test";
  globalThis.fetch = (async () =>
    new Response("<html>gateway error</html>", { status: 200 })) as typeof fetch;
  await assert.rejects(classifyWithClaude(input), ClassifierUnavailable);

  globalThis.fetch = (async () => new Response(
    JSON.stringify({ content: [{ type: "text", text: "sure thing" }] }),
    { status: 200 })) as typeof fetch;
  await assert.rejects(classifyWithClaude(input), ClassifierUnavailable);
});

test("a network failure surfaces as ClassifierUnavailable, not a raw fetch error", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-test";
  globalThis.fetch = (async () => { throw new Error("ECONNREFUSED"); }) as typeof fetch;
  await assert.rejects(classifyWithClaude(input), ClassifierUnavailable);
});

test("the request body carries only booking context", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-test";
  let captured: string | undefined;
  globalThis.fetch = (async (_url: unknown, init: { body: string }) => {
    captured = init.body;
    return new Response(JSON.stringify({ content: [{ type: "tool_use", name: "record_intent",
      input: { intent: "book", doctor: null, day: null, slot_index: null } }] }), { status: 200 });
  }) as unknown as typeof fetch;

  await classifyWithClaude(input);
  assert.match(captured!, /Dr\. Rao/);
  assert.match(captured!, /book me in/);
  assert.doesNotMatch(captured!, /prescription|history|patient_id/i);
});

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
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_COMPAT_API_KEY;
  delete process.env.OPENAI_COMPAT_BASE_URL;
  delete process.env.OPENAI_COMPAT_MODEL;
  delete process.env.GROK_API_KEY;
});

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

/** Reply with one OpenAI-shaped tool_calls entry carrying these fields (JSON-stringified, as these APIs send them). */
function stubCompatFetch(toolInput: Record<string, unknown>, status = 200) {
  process.env.OPENAI_COMPAT_API_KEY = "compat-test";
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ choices: [{ message: { tool_calls: [{
      function: { name: "record_intent", arguments: JSON.stringify(toolInput) },
    }] } }] }),
    { status, headers: { "content-type": "application/json" } },
  )) as typeof fetch;
}

test("a well-formed response passes through", async () => {
  stubFetch({ intent: "book", doctor: "Dr. Rao", day: "2026-09-04", slot_index: 1, name: null });
  const r = await classifyWithClaude(input);
  assert.equal(r.intent, "book");
  assert.equal(r.doctor, "Dr. Rao");
  assert.equal(r.day, "2026-09-04");
  assert.equal(r.slotIndex, 1);
});

test("a doctor who does not work here becomes null", async () => {
  stubFetch({ intent: "book", doctor: "Dr. Sharma", day: null, slot_index: null, name: null });
  assert.equal((await classifyWithClaude(input)).doctor, null);
});

test("an impossible date becomes null rather than reaching the database", async () => {
  for (const day of ["2026-13-45", "2026-02-30", "0000-00-00", "tomorrow", "2026-9-4"]) {
    stubFetch({ intent: "book", doctor: null, day, slot_index: null, name: null });
    assert.equal((await classifyWithClaude(input)).day, null, day);
  }
});

test("an out-of-range or non-integer slot index becomes null", async () => {
  // "1" is deliberately absent: a numeric string is now coerced and range-checked
  // (see "a numeric string slot index is coerced"). Everything here is genuinely unusable.
  for (const slot_index of [-1, 2, 99, 1.5, "one", null]) {
    stubFetch({ intent: "book", doctor: null, day: null, slot_index, name: null });
    assert.equal((await classifyWithClaude(input)).slotIndex, null, String(slot_index));
  }
});

test("an intent outside the enum degrades to unclear, which escalates", async () => {
  for (const intent of ["answer_medical_question", "prescribe", "", null, 42]) {
    stubFetch({ intent, doctor: null, day: null, slot_index: null, name: null });
    assert.equal((await classifyWithClaude(input)).intent, "unclear", String(intent));
  }
});

test("a missing key, a non-200, junk JSON and no tool call all fail loudly", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  await assert.rejects(classifyWithClaude(input), ClassifierUnavailable);

  stubFetch({ intent: "book", doctor: null, day: null, slot_index: null, name: null }, 500);
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

test("the request body carries only the context it was given", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-test";
  let captured: string | undefined;
  globalThis.fetch = (async (_url: unknown, init: { body: string }) => {
    captured = init.body;
    return new Response(JSON.stringify({ content: [{ type: "tool_use", name: "record_intent",
      input: { intent: "book", doctor: null, day: null, slot_index: null, name: null } }] }), { status: 200 });
  }) as unknown as typeof fetch;

  await classifyWithClaude(input);

  // What it was given, it may send.
  assert.match(captured!, /Dr\. Rao/);
  assert.match(captured!, /book me in/);

  // What it was never given must not appear. The request is assembled from the
  // ClassifyInput fields alone, so no identifier from the database can reach it.
  // (The end-to-end version of this guarantee — real prescription and phone in
  // the database, neither reaching the classifier — lives in tests/agent.test.ts,
  // "the classifier is given only booking context, never patient history".)
  assert.doesNotMatch(captured!, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    "no UUID — a patient, doctor or appointment id would show up like this");
  assert.doesNotMatch(captured!, /\+?\d{10,}/, "no phone-shaped digit run");
});

test("with only OPENAI_COMPAT_API_KEY set, a well-formed response classifies correctly", async () => {
  stubCompatFetch({ intent: "book", doctor: "Dr. Rao", day: "2026-09-04", slot_index: 1, name: null });
  const r = await classifyWithClaude(input);
  assert.equal(r.intent, "book");
  assert.equal(r.doctor, "Dr. Rao");
  assert.equal(r.day, "2026-09-04");
  assert.equal(r.slotIndex, 1);
});

test("with OPENAI_COMPAT_BASE_URL unset, the request goes to Groq's default endpoint", async () => {
  process.env.OPENAI_COMPAT_API_KEY = "compat-test";
  let capturedUrl: unknown;
  globalThis.fetch = (async (url: unknown) => {
    capturedUrl = url;
    return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{
      function: { name: "record_intent", arguments: JSON.stringify(
        { intent: "book", doctor: null, day: null, slot_index: null, name: null }) },
    }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;

  await classifyWithClaude(input);
  assert.equal(capturedUrl, "https://api.groq.com/openai/v1/chat/completions");
});

test("OPENAI_COMPAT_BASE_URL is honoured for the request URL", async () => {
  process.env.OPENAI_COMPAT_API_KEY = "compat-test";
  process.env.OPENAI_COMPAT_BASE_URL = "https://example.test/v1";
  let capturedUrl: unknown;
  let capturedHeaders: Record<string, string> | undefined;
  globalThis.fetch = (async (url: unknown, init: { headers: Record<string, string> }) => {
    capturedUrl = url;
    capturedHeaders = init.headers;
    return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{
      function: { name: "record_intent", arguments: JSON.stringify(
        { intent: "book", doctor: null, day: null, slot_index: null, name: null }) },
    }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;

  await classifyWithClaude(input);

  assert.equal(capturedUrl, "https://example.test/v1/chat/completions");
  assert.equal(capturedHeaders!.authorization, "Bearer compat-test");
  assert.equal(capturedHeaders!["x-api-key"], undefined);
});

test("the GROK_API_KEY backward-compatibility path hits api.x.ai", async () => {
  process.env.GROK_API_KEY = "grok-test";
  let capturedUrl: unknown;
  let capturedHeaders: Record<string, string> | undefined;
  globalThis.fetch = (async (url: unknown, init: { headers: Record<string, string> }) => {
    capturedUrl = url;
    capturedHeaders = init.headers;
    return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{
      function: { name: "record_intent", arguments: JSON.stringify(
        { intent: "book", doctor: null, day: null, slot_index: null, name: null }) },
    }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;

  await classifyWithClaude(input);

  assert.equal(capturedUrl, "https://api.x.ai/v1/chat/completions");
  assert.equal(capturedHeaders!.authorization, "Bearer grok-test");
  assert.equal(capturedHeaders!["x-api-key"], undefined);
});

test("JSON-string tool call arguments are parsed", async () => {
  stubCompatFetch({ intent: "cancel", doctor: null, day: null, slot_index: null, name: "Priya" });
  const r = await classifyWithClaude(input);
  assert.equal(r.intent, "cancel");
  assert.equal(r.name, "Priya");
});

test("unparseable tool call arguments throw ClassifierUnavailable", async () => {
  process.env.OPENAI_COMPAT_API_KEY = "compat-test";
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{
    function: { name: "record_intent", arguments: "{not valid json" },
  }] } }] }), { status: 200 })) as typeof fetch;
  await assert.rejects(classifyWithClaude(input), ClassifierUnavailable);
});

test("a response with no tool_calls throws ClassifierUnavailable", async () => {
  process.env.OPENAI_COMPAT_API_KEY = "compat-test";
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: {} }] }),
    { status: 200 })) as typeof fetch;
  await assert.rejects(classifyWithClaude(input), ClassifierUnavailable);
});

test("sanitisation still applies on the OpenAI-compatible path: hallucinated doctor becomes null", async () => {
  stubCompatFetch({ intent: "book", doctor: "Dr. Sharma", day: null, slot_index: null, name: null });
  assert.equal((await classifyWithClaude(input)).doctor, null);
});

test("sanitisation still applies on the OpenAI-compatible path: impossible date becomes null", async () => {
  for (const day of ["2026-13-45", "2026-02-30", "0000-00-00", "tomorrow", "2026-9-4"]) {
    stubCompatFetch({ intent: "book", doctor: null, day, slot_index: null, name: null });
    assert.equal((await classifyWithClaude(input)).day, null, day);
  }
});

test("with both keys set, Anthropic wins", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-test";
  process.env.OPENAI_COMPAT_API_KEY = "compat-test";
  let capturedUrl: unknown;
  globalThis.fetch = (async (url: unknown) => {
    capturedUrl = url;
    return new Response(JSON.stringify({ content: [{ type: "tool_use", name: "record_intent",
      input: { intent: "book", doctor: null, day: null, slot_index: null, name: null } }] }),
      { status: 200 });
  }) as unknown as typeof fetch;

  await classifyWithClaude(input);
  assert.match(String(capturedUrl), /api\.anthropic\.com/);
});

test("a model that emits the string \"null\" instead of null is tolerated", async () => {
  // gpt-oss-20b does exactly this. Observed in live testing: the provider
  // validates tool arguments against our schema server-side and 400s the whole
  // call, which the patient sees as "technical issue".
  stubFetch({ intent: "provide_name", doctor: "null", day: "null",
              slot_index: "null", name: "Ansh Agarwal" });
  const r = await classifyWithClaude(input);
  assert.equal(r.intent, "provide_name");
  assert.equal(r.doctor, null, '"null" is not a real doctor');
  assert.equal(r.day, null, '"null" is not a date');
  assert.equal(r.slotIndex, null, '"null" is not a slot');
  assert.equal(r.name, "Ansh Agarwal");
});

test("a numeric string slot index is coerced, and still range-checked", async () => {
  stubFetch({ intent: "book", doctor: null, day: null, slot_index: "1", name: null });
  assert.equal((await classifyWithClaude(input)).slotIndex, 1);

  for (const bad of ["9", "-1", "1.5", "one", ""]) {
    stubFetch({ intent: "book", doctor: null, day: null, slot_index: bad, name: null });
    assert.equal((await classifyWithClaude(input)).slotIndex, null, bad);
  }
});

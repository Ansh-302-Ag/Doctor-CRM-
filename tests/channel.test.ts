import test from "node:test";
import assert from "node:assert/strict";
import { notifyStaff, sendMessage, sendTemplate } from "../src/lib/channel";

const alert = { clinicName: "Sunrise Clinic", urgent: true, note: "Escalation from ******01." };

/** Run fn with Meta credentials set and fetch stubbed; restore everything after. */
async function withFetch(statuses: number[], fn: (calls: any[]) => Promise<void>) {
  const keys = ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "STAFF_NOTIFY_PHONE"] as const;
  const saved = keys.map(k => process.env[k]);
  const realFetch = globalThis.fetch;
  const calls: any[] = [];
  process.env.WHATSAPP_TOKEN = "t";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "123";
  process.env.STAFF_NOTIFY_PHONE = "919000000000";
  globalThis.fetch = (async (_u: unknown, init: { body: string }) => {
    calls.push(JSON.parse(init.body));
    const status = statuses[calls.length - 1] ?? 200;
    return new Response(status === 400 ? '{"error":{"code":132001}}' : "{}", { status });
  }) as never;
  const log = console.error; console.error = () => {};
  try { await fn(calls); } finally {
    globalThis.fetch = realFetch; console.error = log;
    keys.forEach((k, i) => saved[i] === undefined ? delete process.env[k] : (process.env[k] = saved[i]));
  }
}

test("staff alert is sent as the staff_alert template", () =>
  withFetch([200], async calls => {
    await notifyStaff(alert);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].type, "template");
    assert.equal(calls[0].template.name, "staff_alert");
    assert.deepEqual(calls[0].template.components[0].parameters.map((p: any) => p.text),
      ["Sunrise Clinic", "urgent"]);
  }));

test("an unapproved template falls back to free-form text", () =>
  withFetch([400, 200], async calls => {
    await notifyStaff(alert);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].type, "text");
    assert.equal(calls[1].text.body, alert.note);
  }));

test("if both sends fail, notifyStaff resolves without throwing", () =>
  withFetch([500, 500], async () => { await notifyStaff(alert); }));

test("an authentication template sends the code as body and button parameter", () =>
  withFetch([200], async calls => {
    await sendTemplate({ to: "919000000001", name: "record_code", parameters: ["482913"] });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].template.name, "record_code");
    assert.deepEqual(calls[0].template.components, [
      { type: "body", parameters: [{ type: "text", text: "482913" }] },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "482913" }] },
    ]);
  }));

test("a utility template sends only the body component", () =>
  withFetch([200], async calls => {
    await sendTemplate({ to: "919000000001", name: "prescription_ready",
      parameters: ["Sunrise Clinic", "Dr. Rao", "https://x.test/r/abc"] });
    assert.equal(calls[0].template.components.length, 1);
    assert.equal(calls[0].template.components[0].type, "body");
  }));

test("a Meta rejection error carries the status and code, never the response body", async () => {
  const keys = ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"] as const;
  const saved = keys.map(k => process.env[k]);
  const realFetch = globalThis.fetch;
  process.env.WHATSAPP_TOKEN = "t";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "123";
  // Meta can echo what was sent back in its error details.
  globalThis.fetch = (async () => new Response(
    '{"error":{"code":131047,"message":"Re-engagement","error_data":{"details":"https://x/r/SECRETTOKEN"}}}',
    { status: 400 })) as never;
  try {
    for (const send of [
      () => sendMessage({ to: "919000000001", text: "https://x/r/SECRETTOKEN" }),
      () => sendTemplate({ to: "919000000001", name: "record_code", parameters: ["482913"] }),
    ]) {
      await assert.rejects(send, (e: Error) => {
        assert.match(e.message, /400/);
        assert.match(e.message, /131047/);
        assert.doesNotMatch(e.message, /SECRETTOKEN|Re-engagement|482913/);
        return true;
      });
    }
  } finally {
    globalThis.fetch = realFetch;
    keys.forEach((k, i) => saved[i] === undefined ? delete process.env[k] : (process.env[k] = saved[i]));
  }
});

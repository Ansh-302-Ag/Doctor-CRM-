import test from "node:test";
import assert from "node:assert/strict";
import { TEMPLATES, renderTemplate, MissingTemplateParameter } from "../src/lib/templates";

test("every template's parameter list matches its body placeholders", () => {
  for (const spec of Object.values(TEMPLATES)) {
    const placeholders = [...spec.bodyText.matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1]));
    assert.deepEqual(placeholders, placeholders.map((_, i) => i + 1),
      `${spec.name}: placeholders must be {{1}}..{{n}} in order`);
    assert.equal(placeholders.length, spec.params.length,
      `${spec.name}: ${placeholders.length} placeholders but ${spec.params.length} named params`);
  }
});

test("no template body starts or ends with a placeholder", () => {
  // Meta rejects a template whose body opens or closes on a variable. An
  // authentication template's wording is Meta's own ("{{1}} is your
  // verification code."), fixed by Meta, so the rule does not apply to it.
  for (const spec of Object.values(TEMPLATES).filter(t => t.category !== "authentication")) {
    assert.doesNotMatch(spec.bodyText, /^\s*\{\{\d+\}\}|\{\{\d+\}\}\s*$/,
      `${spec.name}: body must not start or end with {{n}}`);
  }
});

test("rendering substitutes parameters in the declared order", () => {
  const r = renderTemplate("appointment_reminder", {
    clinic_name: "Sunrise Clinic", doctor_name: "Dr. Rao", appointment_time: "Fri 4 Sept, 10:00 am",
  });
  assert.deepEqual(r.parameters, ["Sunrise Clinic", "Dr. Rao", "Fri 4 Sept, 10:00 am"]);
  assert.match(r.preview, /Sunrise Clinic/);
  assert.doesNotMatch(r.preview, /\{\{/);
});

test("a missing parameter is refused rather than sent as a gap", () => {
  assert.throws(
    () => renderTemplate("appointment_reminder", { clinic_name: "Sunrise Clinic" }),
    MissingTemplateParameter,
  );
});

test("no template contains clinical language", () => {
  // docs/01: a reminder tells someone about a logistics event. It never advises.
  const banned = /\b(dose|dosage|take|should|symptom|treat|cure|diagnos|safe|healthy)\b/i;
  for (const spec of Object.values(TEMPLATES)) {
    assert.doesNotMatch(spec.bodyText, banned, `${spec.name} contains clinical language`);
  }
});

test("the refill template names no drug — only the clinic and the doctor", () => {
  const r = renderTemplate("refill_followup", {
    clinic_name: "Sunrise Clinic", doctor_name: "Dr. Rao",
  });
  assert.deepEqual(TEMPLATES.refill_followup.params, ["clinic_name", "doctor_name"]);
  assert.equal(r.preview,
    "Hello from Sunrise Clinic. Dr. Rao asked us to check in about your prescription. " +
    "Reply to this message and we will help.");
});

test("no template is about health content", () => {
  // Meta's Business Messaging Policy: no health information on WhatsApp.
  for (const spec of Object.values(TEMPLATES)) {
    assert.doesNotMatch(spec.bodyText, /\b(dosage|dose|drug|medicine|tablet)s?\b/i,
      `${spec.name} talks about health content`);
  }
});

test("the code template is an authentication template; the rest are utility", () => {
  assert.equal(TEMPLATES.record_code.category, "authentication");
  assert.deepEqual(TEMPLATES.record_code.params, ["code"]);
  for (const spec of Object.values(TEMPLATES)) {
    if (spec.name !== "record_code") assert.equal(spec.category, "utility", spec.name);
  }
});

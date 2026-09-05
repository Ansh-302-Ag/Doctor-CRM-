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

test("the refill template names the drug but says nothing about taking it", () => {
  const r = renderTemplate("refill_followup", {
    clinic_name: "Sunrise Clinic", drug_name: "Amoxicillin",
  });
  assert.match(r.preview, /Amoxicillin/);
  assert.match(r.preview, /clinic/i);
});

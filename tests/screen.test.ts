import test from "node:test";
import assert from "node:assert/strict";
import { screen, guessIntent } from "../src/lib/agent/screen";

test("emergency phrasing is caught before anything else", () => {
  for (const m of [
    "I'm having chest pain right now",
    "my father cant breathe",
    "the bleeding heavily wont stop",
    "I think he had a seizure",
  ]) assert.equal(screen(m).verdict, "emergency", m);
});

test("clinical questions are caught, including ones wrapped in a booking request", () => {
  for (const m of [
    "can I take paracetamol with the antibiotics Dr Rao gave me",
    "is this rash normal after the injection",
    "should I stop the tablets now that I feel better",
    "book me an appointment, also is it serious that I still have a fever",
    "what are the side effects of amoxicillin",
  ]) assert.equal(screen(m).verdict, "clinical", m);
});

test("plain logistics messages pass the screen", () => {
  for (const m of [
    "Hi, I need an appointment with Dr. Rao",
    "can I move my Friday booking to Monday",
    "please cancel my appointment",
    "when is my next appointment",
  ]) assert.equal(screen(m).verdict, "clear", m);
});

test("the screen never returns an answer, only a routing verdict", () => {
  const s = screen("can I take this with my BP medicine");
  assert.equal(s.verdict, "clinical");
  assert.ok(!("reply" in s), "the screen must not be able to produce a clinical reply");
});

test("intent guessing covers the logistics set and falls back to unclear", () => {
  assert.equal(guessIntent("I want to book an appointment"), "book");
  assert.equal(guessIntent("can I reschedule my appointment"), "reschedule");
  assert.equal(guessIntent("cancel please"), "cancel");
  assert.equal(guessIntent("when is my next appointment"), "check_appointment");
  assert.equal(guessIntent("what prescription am I on"), "check_prescription_record");
  assert.equal(guessIntent("yes"), "consent_yes");
  assert.equal(guessIntent("delete my data"), "delete_my_data");
  assert.equal(guessIntent("hmm ok whatever asdf"), "unclear");
});

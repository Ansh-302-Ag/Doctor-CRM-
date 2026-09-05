import test from "node:test";
import assert from "node:assert/strict";
import { screen } from "../src/lib/agent/screen";

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

test("the agent's own booking prompts are not mistaken for drug questions", () => {
  // The agent ends every slot offer with "Which one works?" — these are answers
  // to that question, and escalating them sends ordinary bookings to a human.
  for (const m of [
    "can I take the 4pm slot",
    "can I take the first one",
    "can I take the 10:30 appointment",
    "should I take the second one",
    "can I have the 9 am slot please",
  ]) assert.equal(screen(m).verdict, "clear", m);
});

test("emergencies survive ordinary phrasing, punctuation and Hinglish", () => {
  // Every one of these was verified to slip through the first version.
  for (const m of [
    "I have a lot of pain in my chest",
    "I can not breathe properly",
    "trouble breathing",
    "breathing problem since morning",
    "my wife is vomiting blood",
    "the baby is not moving",
    "my son swallowed some tablets",
    "CHEST-PAIN!!",
    "she collapsed and is not responding",
    "mujhe seene mein dard ho raha hai",
    "saans nahi aa rahi",
    "bahut khoon beh raha hai",
    "wo behosh ho gayi hai",
  ]) assert.equal(screen(m).verdict, "emergency", m);
});

test("triage dressed as logistics is clinical, not a booking", () => {
  for (const m of [
    "should I come in for this cough or wait it out",
    "do I need to see the doctor for a fever",
    "is it worth coming in for this",
  ]) assert.equal(screen(m).verdict, "clinical", m);
});

test("the escalation reason shown to staff is readable, not a raw regex", () => {
  const s = screen("I have a lot of pain in my chest");
  assert.equal(s.verdict, "emergency");
  assert.doesNotMatch((s as { matched: string }).matched, /\[\^|\\b|\{0,/);
});

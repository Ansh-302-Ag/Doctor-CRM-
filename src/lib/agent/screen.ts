/**
 * The safety screen: a deterministic pass that runs BEFORE any model sees the
 * message, and whose verdict a model can never override (docs/01, docs/05).
 *
 * The rule from docs/01: if a message could be read two ways, one logistical and
 * one clinical, it is clinical. Ambiguity resolves toward the human, always.
 */

export type Screen =
  | { verdict: "emergency"; matched: string }
  | { verdict: "clinical"; matched: string }
  | { verdict: "clear" };

/** Words that mean "tell them to call emergency services now", not "queue for staff". */
const EMERGENCY = [
  "chest pain", "can't breathe", "cant breathe", "cannot breathe", "not breathing",
  "difficulty breathing", "breathless", "unconscious", "passed out", "fainted",
  "severe bleeding", "bleeding heavily", "won't stop bleeding", "wont stop bleeding",
  "stroke", "heart attack", "seizure", "convulsion", "overdose", "poison",
  "suicidal", "kill myself", "end my life", "severe pain", "collapsed",
];

/** Anything that would need clinical judgement to answer. Deliberately broad. */
const CLINICAL: (string | RegExp)[] = [
  "side effect", "side-effect", "interaction", "interact with", "safe to take",
  "can i take", "should i take", "should i stop", "stop taking", "skip a dose",
  "double dose", "increase the dose", "reduce the dose", "change my dose",
  "allergic", "allergy", "reaction to",
  "should i worry", "worried about", "diagnos", "do i have",
  "symptom", "treatment for", "how long until i feel", "prescribe me",
  "second opinion", "test result", "lab result", "report say",
  // "is this rash normal", "is it serious", "is that swelling normal"
  /\bis (this|that|it|my)\b[^?]{0,40}\b(normal|serious|ok|okay|fine|bad)\b/,
  /\bwhat('| i)?s wrong with (me|him|her)\b/,
];

const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function screen(body: string): Screen {
  const text = normalise(body);
  const emergency = EMERGENCY.find(k => text.includes(k));
  if (emergency) return { verdict: "emergency", matched: emergency };
  const clinical = CLINICAL.find(k =>
    typeof k === "string" ? text.includes(k) : k.test(text));
  if (clinical) return { verdict: "clinical", matched: String(clinical) };
  return { verdict: "clear" };
}

/**
 * Templated replies. These are never model-generated — a garbled emergency
 * message is a real harm, so the exact words are fixed here (docs/05).
 */
export const templates = {
  emergency: (clinicPhone: string) =>
    `If this is a medical emergency, call 112 (or your local emergency number) or ` +
    `go to the nearest emergency room right now. I have alerted the clinic team ` +
    `immediately. You can also call the clinic on ${clinicPhone}.`,

  clinical: (clinicPhone: string) =>
    `I am not able to answer medical questions. I have passed this to the clinic ` +
    `team and they will get back to you shortly. If it is urgent, please call the ` +
    `clinic on ${clinicPhone}.`,

  technicalFailure: () =>
    `Sorry — I am having a technical issue right now. A member of the clinic team ` +
    `will follow up with you shortly.`,

  unclear: () =>
    `Sorry, I did not follow that. I have passed it to the clinic team so someone ` +
    `can help you directly.`,
} as const;

/** Logistics intents the agent has tools for. Anything else escalates. */
export type Intent =
  | "book" | "reschedule" | "cancel"
  | "check_appointment" | "check_prescription_record"
  | "consent_yes" | "delete_my_data"
  | "unclear";

/**
 * Deterministic intent guess. Used as-is when no model is configured, and as the
 * prior the model has to beat. It only ever returns a logistics intent or
 * "unclear" — it has no way to express a clinical answer.
 */
export function guessIntent(body: string): Intent {
  const t = normalise(body);
  if (/^(yes|y|yes please|ok|okay|agree|i agree|haan|ha)\b/.test(t)) return "consent_yes";
  if (/\b(delete my data|delete my details|forget me|remove my data|withdraw consent)\b/.test(t))
    return "delete_my_data";
  if (/\b(cancel)\b/.test(t)) return "cancel";
  if (/\b(reschedule|resched|move|change|shift|postpone)\b/.test(t) && /\b(appointment|booking|slot|visit)\b/.test(t))
    return "reschedule";
  // Checked before "book", since both mention "appointment".
  if (/\b(when is|what time|my next|upcoming|do i have an)\b/.test(t) && /\b(appointment|visit|booking)\b/.test(t))
    return "check_appointment";
  if (/\b(book|appointment|schedule|slot|see the doctor|consult|visit)\b/.test(t)) return "book";
  if (/\b(prescription|medicine|medication|tablet|what did the doctor give)\b/.test(t))
    return "check_prescription_record";
  return "unclear";
}

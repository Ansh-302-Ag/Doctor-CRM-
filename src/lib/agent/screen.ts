/**
 * The safety screen: a deterministic pass that runs BEFORE any model sees the
 * message, and whose verdict a model can never override (docs/01, docs/05).
 *
 * The rule from docs/01: if a message could be read two ways, one logistical and
 * one clinical, it is clinical. Ambiguity resolves toward the human, always.
 *
 * Patterns are matched against a normalised form (lowercased, punctuation
 * flattened to spaces) so "CHEST-PAIN" and "chest pain" behave the same.
 *
 * The pilot clinic is in India and patients write in Hinglish as often as
 * English, so the emergency list carries transliterated Hindi. This is a
 * starting corpus, not a complete one: every escalation whose text should have
 * matched and did not belongs back in this file (see tests/screen.test.ts).
 */

export type Screen =
  | { verdict: "emergency"; matched: string }
  | { verdict: "clinical"; matched: string }
  | { verdict: "clear" };

/** A plain string matches itself and reads fine in an escalation reason.
 *  A regex needs a human label, because staff see this text in the inbox. */
type Pattern = string | [RegExp, string];

/** Means "tell them to call emergency services now", not "queue for staff". */
const EMERGENCY: Pattern[] = [
  // Cardiac / respiratory. Loose enough for "a lot of pain in my chest".
  [/\bchest\b[^.]{0,25}\bpain\b/, "chest pain"], [/\bpain\b[^.]{0,25}\bchest\b/, "chest pain"],
  [/\bheart attack\b/, "heart attack"], [/\bcardiac\b/, "cardiac"],
  [/\b(can ?not|cant|can t|unable to|trouble|difficulty|hard to|struggling to)\b[^.]{0,15}\bbreath/, "difficulty breathing"],
  [/\bbreath(ing|less)?\b[^.]{0,15}\b(problem|trouble|difficulty|issue)/, "difficulty breathing"],
  [/\bnot breathing\b/, "not breathing"], [/\bgasping\b/, "gasping"], [/\bchoking\b/, "choking"], [/\bsuffocat/, "suffocating"],
  // Bleeding, trauma, poisoning.
  [/\bbleed(ing)?\b[^.]{0,20}\b(heavy|heavily|lot|badly|wont stop|will not stop|non stop)\b/, "heavy bleeding"],
  [/\b(heavy|heavily|lot of|severe|uncontrolled)\b[^.]{0,15}\bbleed/, "heavy bleeding"],
  [/\bvomit(ing)?\b[^.]{0,15}\bblood\b/, "vomiting blood"], [/\bblood\b[^.]{0,15}\bvomit/, "vomiting blood"],
  [/\bcoughing up blood\b/, "coughing up blood"], [/\bswallow(ed)?\b[^.]{0,25}\b(tablet|pill|poison|chemical|battery)/, "swallowed something"],
  "overdose", "poisoned", "poisoning",
  // Neurological / consciousness.
  "unconscious", "passed out", "fainted", "collapsed", "not responding",
  "unresponsive", "stroke", "seizure", "convulsion", "fitting",
  // Obstetric and paediatric red flags.
  [/\bbaby\b[^.]{0,20}\bnot (moving|breathing|responding)\b/, "baby not responding"],
  [/\b(water|waters) broke\b/, "waters broke"], [/\bin labour\b/, "in labour"], [/\bin labor\b/, "in labour"],
  // Severity words.
  [/\bsevere\b[^.]{0,15}\b(pain|bleeding|reaction)\b/, "severe pain or bleeding"],
  "emergency", "ambulance", "call 108", "call 112",
  // Self-harm.
  "suicidal", "kill myself", "end my life", "harm myself",
  // Hinglish / transliterated Hindi. Patients switch mid-sentence; match anywhere.
  [/\bseene? me(in)?\b[^.]{0,15}\bdard\b/, "chest pain (Hindi)"],          // pain in the chest
  [/\bsaans\b[^.]{0,20}\b(nahi|nai|band|dikkat|takleef|problem)\b/, "difficulty breathing (Hindi)"],  // can't breathe
  [/\bdum ghut/, "suffocating (Hindi)"],                                     // suffocating
  [/\bkhoon\b[^.]{0,20}\b(beh|nikal|band nahi|bah)/, "bleeding (Hindi)"], // bleeding
  [/\bbehosh\b/, "unconscious (Hindi)"], [/\bbehoshi\b/, "unconscious (Hindi)"],                      // unconscious
  [/\bmirgi\b/, "seizure (Hindi)"],                                      // seizure
  [/\bzeher\b/, "poison (Hindi)"],                                      // poison
  [/\bbahut (tez|zyada) dard\b/, "severe pain (Hindi)"],                     // very severe pain
  [/\bemergency hai\b/, "emergency (Hindi)"], [/\bjaan\b[^.]{0,15}\bkhatra\b/, "life in danger (Hindi)"],
];

/**
 * Anything that would need clinical judgement to answer. Deliberately broad,
 * but not so broad that it swallows the agent's own booking prompts — "can I
 * take the 4pm slot" is an answer to "which one works?", not a drug question.
 */
const CLINICAL: Pattern[] = [
  "side effect", "side-effect", "drug interaction", "interact with",
  [/\b(safe|ok|okay|alright|fine) to (take|use|have|drink|eat)\b/, "is it safe to take"],
  // "can I take X" is clinical unless X is unmistakably one of the slots we
  // just offered — the agent ends every offer with "Which one works?", and
  // "can I take the 4pm one" is an answer to that, not a drug question.
  // The allowlist stays narrow on purpose: "this", "it" and "that" are NOT on
  // it, so "can I take this with my BP medicine" stays clinical.
  [/\b(can|should|may) i (take|have|use|stop|skip|double|increase|reduce|change)\b(?![^.]{0,25}\b(slot|appointment|booking|(first|second|third|fourth|last) one|\d{1,2}\s?(am|pm)|\d{1,2}[:.]\d{2})\b)/, "can I take (a medicine)"],
  [/\bstop (taking|the tablets|the medicine|my medication)\b/, "stopping medication"],
  [/\b(skip|miss(ed)?|double|increase|reduce|change|adjust)\b[^.]{0,10}\b(dose|dosage)\b/, "changing a dose"],
  "allergic", "allergy", "reaction to", "rash after", "swelling after",
  "should i worry", "worried about", "diagnos", "do i have",
  "symptom", "treatment for", "how long until i feel", "prescribe me",
  "second opinion", "test result", "lab result", "report say",
  // "is this rash normal", "is it serious", "is that swelling normal"
  [/\bis (this|that|it|my)\b[^?.]{0,40}\b(normal|serious|bad|dangerous|infected)\b/, "is this normal"],
  [/\bwhat('| i)?s wrong with (me|him|her)\b/, "what's wrong with me"],
  // Triage disguised as logistics: "should I come in for this, or wait?"
  [/\b(do|should) i (need to )?(come in|see the doctor|get checked|be seen)\b/, "should I be seen"],
  [/\bis it (worth|necessary) (coming|seeing|to see)\b/, "should I be seen"],
  // Hinglish clinical.
  [/\bdawa(i|ai)?\b[^.]{0,20}\b(le sakta|le sakti|band|chalu)\b/, "medication question (Hindi)"],
  [/\bkya\b[^.]{0,20}\bnormal hai\b/, "is this normal (Hindi)"],
];

/** Lowercase, and flatten punctuation so "CHEST-PAIN!" reads as "chest pain". */
const normalise = (s: string) =>
  s.toLowerCase().replace(/[^\p{L}\p{N}'?.]+/gu, " ").replace(/\s+/g, " ").trim();

const firstMatch = (text: string, patterns: Pattern[]) =>
  patterns.find(p => (typeof p === "string" ? text.includes(p) : p[0].test(text)));

/** Staff read this in the escalation inbox, so it is a phrase, never a regex. */
const label = (p: Pattern) => (typeof p === "string" ? p : p[1]);

export function screen(body: string): Screen {
  const text = normalise(body);
  const emergency = firstMatch(text, EMERGENCY);
  if (emergency) return { verdict: "emergency", matched: label(emergency) };
  const clinical = firstMatch(text, CLINICAL);
  if (clinical) return { verdict: "clinical", matched: label(clinical) };
  return { verdict: "clear" };
}

/**
 * Templated replies. These are never model-generated — a garbled emergency
 * message is a real harm, so the exact words are fixed here (docs/05).
 */
export const templates = {
  emergency: (clinicPhone: string) =>
    `If this is a medical emergency, call 112 (or 108 for an ambulance) or go to ` +
    `the nearest emergency room right now. I have alerted the clinic team ` +
    `immediately. You can also call the clinic on ${clinicPhone}.`,

  clinical: (clinicPhone: string) =>
    `I am not able to answer medical questions. I have passed this to the clinic ` +
    `team and they will get back to you shortly. If it is urgent, please call the ` +
    `clinic on ${clinicPhone}.`,

  technicalFailure: () =>
    `Sorry — I am having a technical issue right now. A member of the clinic team ` +
    `will follow up with you shortly.`,

  /**
   * The reply when nothing matched and nothing was understood. It has to carry
   * the emergency route too: a message the screen missed lands here, and the
   * patient must never be left with only "I did not follow that" (docs/01).
   */
  unclear: (clinicPhone: string) =>
    `Sorry, I did not follow that — I have passed it to the clinic team so ` +
    `someone can help you directly. If this is a medical emergency, call 112 ` +
    `or go to the nearest emergency room now. To reach the clinic directly, ` +
    `call ${clinicPhone}.`,
} as const;

import type { Classifier, Classification, ClassifyInput } from "../src/lib/agent/intent";

/**
 * A scripted stand-in for the model, so the state-machine tests assert routing
 * and booking behaviour rather than the model's mood. The live model is covered
 * separately in tests/intent.live.test.ts.
 */
export function stub(script: (i: ClassifyInput) => Partial<Classification>): Classifier {
  return async (i) => ({
    intent: "unclear", doctor: null, day: null, slotIndex: null, time: null, name: null,
    ...script(i),
  });
}

/** Enough of a parser to drive the tests: the model does this job in production. */
export const scripted: Classifier = stub(i => {
  const t = i.body.toLowerCase();
  const doctor = i.doctors.find(d =>
    t.includes(d.toLowerCase().replace(/^dr\.?\s*/, ""))) ?? null;

  const day =
    /\btomorrow\b/.test(t) ? offsetDay(i.today, 1) :
    /\btoday\b/.test(t) ? i.today :
    (t.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] ?? null);

  // "10:00", or "11:00 pm" for a time no offer contains.
  const clock = t.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?/);
  const time = clock ? to24(clock[1], clock[2], clock[3]) : null;
  const slotIndex = clock
    ? nullIfMissing(i.offered.findIndex(o => o.includes(asOffered(clock[1], clock[2], clock[3]))))
    : null;

  const intent =
    /^(yes|y|ok|okay|agree)\b/.test(t) ? "consent_yes" :
    /delete my data|forget me|withdraw consent/.test(t) ? "delete_my_data" :
    /\bcancel\b/.test(t) ? "cancel" :
    /\b(reschedule|move|postpone)\b/.test(t) ? "reschedule" :
    /\b(when is|what time|my next|upcoming)\b/.test(t) ? "check_appointment" :
    /\b(prescription|medicine|medication)\b/.test(t) ? "check_prescription_record" :
    /\b(book|appointment|schedule|slot)\b/.test(t) ? "book" :
    (doctor || day || time || slotIndex !== null) ? "book" : "unclear";

  return { intent, doctor, day, slotIndex, time, name: null };
});

const nullIfMissing = (n: number) => (n < 0 ? null : n);
const offsetDay = (day: string, n: number) =>
  new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const to24 = (h: string, m: string, ampm?: string) => {
  const n = Number(h) % 12;
  return `${String(ampm === "pm" ? n + 12 : ampm === "am" ? n : Number(h)).padStart(2, "0")}:${m}`;
};

/** The offered strings are "Fri 4 Sept, 9:00 am"; the test says "9:00" — or
 *  "11:00 pm", which must NOT match an offered "11:00 am". */
const asOffered = (h: string, m: string, ampm?: string) =>
  `${((Number(h) + 11) % 12) + 1}:${m}${ampm ? ` ${ampm}` : ""}`;

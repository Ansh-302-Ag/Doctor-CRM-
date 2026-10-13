/**
 * The agent: a thin orchestrator over a fixed tool set (docs/03, docs/05).
 *
 * Order of business for every inbound message, and it does not vary:
 *   1. dedupe on the provider's message id      (docs/08 — webhook redelivery)
 *   2. deterministic safety screen              (docs/01 — clinical always escalates)
 *   3. consent gate                             (docs/02 — no booking without consent)
 *   4. model classifies the logistics phrasing, then one tool call — or escalate
 *
 * The model sits at step 4, behind the screen, and only ever chooses among
 * logistics intents. It cannot reach step 2's verdict and has no tool that
 * could answer a clinical question.
 *
 * Conversation state lives in the database, never in agent memory, so any
 * instance can pick up any conversation (docs/03).
 */
import type { Db, Pool } from "../db";
import { tools } from "./tools";
import { screen, templates } from "./screen";
import {
  classifyWithClaude, ClassifierUnavailable,
  type Classifier, type Classification, type ConversationStep,
} from "./intent";
import {
  CONSENT_NOTICE, introduction, isAffirmative, recordConsent, withdrawAndDelete, ConsentRequired,
} from "../consent";
import { BookingError, OPEN_HOUR, CLOSE_HOUR, OPEN_DAYS, requireTimezone } from "../booking";
import { setPatientName } from "../patients";

/** `urgent` is set when the escalation was an emergency, so the page that
 *  follows can say so; the patient-facing text is the same either way. */
export type Reply = { text: string; escalated: boolean; urgent?: boolean };

type BookingState = {
  flow: "booking";
  step: ConversationStep;
  doctorId: string | null;
  reason?: string;
  /** A day the patient has already named, held while we stop to ask something
   *  else (which doctor, what name). Without it the answer is collected and
   *  then thrown away, and they are asked for a day they already gave. */
  day?: string;
  offered?: string[];          // ISO instants, in the order shown to the patient
  /** Set when this flow is moving an existing appointment. Carried rather than
   *  re-derived, so a second booking made meanwhile cannot move the wrong one. */
  reschedulingId?: string;
};
/** What the patient asked for before we stopped to collect consent or a name,
 *  so the request can be honoured rather than dropped once they answer. */
type PendingState = { pending: string };
/**
 * Whatever the conversation is in the middle of, plus how many messages in a
 * row we have failed to read. The two are independent — a patient can be
 * mid-booking and unreadable — so the count rides alongside the flow instead of
 * replacing it, and handing over to a human never takes the flow with it.
 */
type ConversationState =
  Partial<BookingState> & Partial<PendingState> & { unclear?: number };

const isBooking = (s: ConversationState): s is BookingState => s.flow === "booking";
const isPending = (s: ConversationState): s is PendingState =>
  typeof s.pending === "string";

/** Two messages we cannot read earn another try at the question; the third
 *  earns a person. Pre- and post-consent alike: one counter, one threshold. */
const MAX_UNCLEAR = 2;

const fmtTime = (at: Date, tz: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: requireTimezone(tz), weekday: "short", day: "numeric", month: "short",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).format(at);

const dayIn = (at: Date, tz: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: requireTimezone(tz) }).format(at);

const weekdayIn = (at: Date, tz: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: requireTimezone(tz), weekday: "long" }).format(at);

/** Offered times, numbered as the patient sees them — "the 3rd one" then refers
 *  to something written down rather than something they have to count. */
const timesText = (offered: string[], tz: string, prefix = "") =>
  `${prefix} These times are free:\n${
    offered.map((iso, i) => `${i + 1}. ${fmtTime(new Date(iso), tz)}`).join("\n")
  }\n\nWhich one works?`.trim();

const hour12 = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? "am" : "pm"}`;
/** Read off the real schedule, so this sentence cannot drift from it. */
const clinicHours = () =>
  `I can only book between ${hour12(OPEN_HOUR)} and ${hour12(CLOSE_HOUR)}, ` +
  `${[...OPEN_DAYS].join(", ")}.`;
const outsideHours = (time: string) =>
  Number(time.slice(0, 2)) < OPEN_HOUR || Number(time.slice(0, 2)) >= CLOSE_HOUR;

export type InboundMessage = {
  clinicId: string;
  phone: string;
  body: string;
  providerMessageId: string;
  /** Set for a message we cannot read (image, voice, edit...); absent = typed text. */
  kind?: string;
};

/**
 * Handle one inbound message. Returns the reply to send, or null when the
 * message was a duplicate delivery and must be a no-op.
 *
 * Everything one message does happens in a single transaction. A reschedule
 * releases the old slot before taking the new one, and a DPDP deletion touches
 * four tables; without a transaction a mid-flight failure leaves the patient's
 * appointment released and unbooked, or their record half-deleted, while they
 * are told it did not work.
 *
 * `classify` is the model call; it is a parameter so tests can drive the state
 * machine deterministically without a network round trip per assertion.
 */
export async function handleInbound(
  pool: Pool,
  msg: InboundMessage,
  now = new Date(),
  classify: Classifier = classifyWithClaude,
): Promise<Reply | null> {
  return pool.begin(tx => inTransaction(tx, msg, now, classify)) as Promise<Reply | null>;
}

async function inTransaction(
  db: Db,
  msg: InboundMessage,
  now: Date,
  classify: Classifier,
): Promise<Reply | null> {
  // 1. Dedupe. The unique index on provider_message_id is the real guard;
  //    this check just avoids doing the work twice in the common case.
  const [seen] = await db`select 1 from messages
                           where provider_message_id = ${msg.providerMessageId}`;
  if (seen) return null;

  const ctx = await context(db, msg);
  const body = msg.kind ? `[${msg.kind}]` : msg.body;

  try {
    await db`insert into messages (conversation_id, direction, body, provider_message_id)
             values (${ctx.conversation.id}, 'inbound', ${body}, ${msg.providerMessageId})`;
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return null;   // raced duplicate
    throw e;
  }
  await db`update conversations set last_message_at = now() where id = ${ctx.conversation.id}`;

  // Nothing to screen or classify in a message we cannot read, so asking the
  // patient to type it is the answer — with the emergency route, since it may
  // be the emergency we cannot see. A voice-only patient would loop on that
  // forever, so it counts toward the same three-in-a-row as unclear text.
  const reply: Routed = msg.kind
    ? await reaskIn(db, ctx, unreadable(msg.kind, ctx.clinic.phone),
        "repeatedly unreadable messages (voice/photo)", "unreadable")
    : await route(db, msg, ctx, now, classify);

  await db`insert into messages (conversation_id, direction, body, intent_classified)
           values (${ctx.conversation.id}, 'outbound', ${reply.text}, ${reply.intent ?? null})`;
  return { text: reply.text, escalated: reply.escalated, urgent: reply.urgent };
}

function unreadable(kind: string, clinicPhone: string) {
  return (kind === "edit"
    ? "Edited messages can't be read here. Please send your message again as a new message."
    : `I can only read typed messages. Please type what you need, for example "book an appointment".`) +
    ` If it is urgent, call 112 (or 108 for an ambulance), or call the clinic on ${clinicPhone}.`;
}

type Ctx = {
  clinic: { id: string; name: string; timezone: string; phone: string };
  patient: { id: string; consent_status: string; name: string | null };
  conversation: { id: string; state: ConversationState };
};
type Routed = { text: string; escalated: boolean; urgent?: boolean; intent?: string };

async function escalateIn(
  db: Db, ctx: Ctx, reason: string, priority: "normal" | "emergency", text: string, intent?: string,
): Promise<Routed> {
  // Deliberately does NOT clear the conversation state. A human stepping in
  // does not mean the doctor, day and times the patient already gave are
  // thrown away — they used to be, and the patient started over every time.
  await tools.escalate_to_human({
    db, conversationId: ctx.conversation.id, patientId: ctx.patient.id, reason, priority,
  });
  return { text, escalated: true, urgent: priority === "emergency", intent };
}

/**
 * We could not read an answer to the question we are waiting on. Ask it
 * again — an unreadable message is not a reason to hand the conversation to
 * a nurse, it is a reason to repeat the question. Three in a row is a
 * conversation going nowhere, and that is.
 */
async function reaskIn(
  db: Db, ctx: Ctx, question: string, reason: string, intent = "unclear",
  keep: ConversationState = {},
): Promise<Routed> {
  const state = ctx.conversation.state;
  const seen = (state.unclear ?? 0) + 1;
  const stuck = seen > MAX_UNCLEAR;
  // Anything the message did tell us is kept either way — a message that
  // answers one question and misses another must not cost us the answer.
  await setState(db, ctx.conversation.id,
    { ...state, ...keep, unclear: stuck ? 0 : seen });
  if (stuck) {
    return escalateIn(db, ctx, `${reason} (${seen} messages in a row)`, "normal",
      templates.unclear(ctx.clinic.phone), "unclear");
  }
  return { text: question, escalated: false, intent };
}

async function route(
  db: Db, msg: InboundMessage, ctx: Ctx, now: Date, classify: Classifier,
): Promise<Routed> {
  const escalate: Escalate = (...a) => escalateIn(db, ctx, ...a);

  // 2. The safety screen runs before the model and cannot be overridden.
  const verdict = screen(msg.body);
  if (verdict.verdict === "emergency") {
    return escalate(`emergency signal: matched "${verdict.matched}"`, "emergency",
      templates.emergency(ctx.clinic.phone), "emergency_signal");
  }
  if (verdict.verdict === "clinical") {
    return escalate(`clinical question: matched "${verdict.matched}"`, "normal",
      templates.clinical(ctx.clinic.phone), "clinical_question");
  }

  const state = ctx.conversation.state;
  const doctors = await db<{ id: string; name: string }[]>`
    select id, name from doctors where clinic_id = ${ctx.clinic.id} order by name`;
  const offeredIso = (isBooking(state) && state.offered) || [];

  // Consent counts only as an answer to the notice, however it is read: a "yes"
  // after a withdrawal or an emergency reply agrees to nothing.
  const justAsked = ctx.patient.consent_status !== "granted"
    && await justAskedForConsent(db, ctx.conversation.id);

  let c: Classification;
  if (justAsked && isAffirmative(msg.body)) {
    // "OK", "haan" and a thumbs-up are consent, and the model sometimes reads
    // them as unclear — so it is not asked.
    c = { intent: "consent_yes", doctor: null, day: null, slotIndex: null, time: null, name: null };
  } else try {
    c = await classify({
      body: msg.body,
      doctors: doctors.map(d => d.name),
      offered: offeredIso.map(iso => fmtTime(new Date(iso), ctx.clinic.timezone)),
      today: dayIn(now, ctx.clinic.timezone),
      weekday: weekdayIn(now, ctx.clinic.timezone),
      // Which question this message is answering. A bare "Dr. Rao" is only
      // readable as an answer if the model is told what was asked.
      step: isBooking(state) ? state.step : null,
    });
  } catch (e) {
    // docs/08: the model being down never drops a message silently.
    if (!(e instanceof ClassifierUnavailable)) throw e;
    return escalate(`classifier unavailable: ${e.message}`, "normal",
      templates.technicalFailure(), "classifier_unavailable");
  }

  // The count below is of CONSECUTIVE misses, so this message clears it up
  // front; reask() writes it straight back (from the count it started with) if
  // this one is another miss.
  if (state.unclear) await setState(db, ctx.conversation.id, { ...state, unclear: 0 });
  const reask: Reask = (...a) => reaskIn(db, ctx, ...a);

  // 3. Consent gate. Nothing proceeds past here without a recorded 'granted'.
  if (c.intent === "delete_my_data") {
    await withdrawAndDelete(db, { kind: "agent" }, ctx.patient.id);
    return {
      text: "Your consent has been withdrawn and your details are scheduled for deletion. " +
            "Any upcoming appointments have been cancelled.",
      escalated: false, intent: c.intent,
    };
  }
  if (ctx.patient.consent_status !== "granted") {
    // An un-understood message from someone we have never met still reaches a
    // human. Consent governs storing and acting on their data, not whether we
    // are allowed to notice they need help (docs/01).
    // A "yes" to a question we did not just ask is as unclear as any other
    // message: show the notice, so there is something for them to agree to.
    if (c.intent === "unclear" || (c.intent === "consent_yes" && !justAsked)) {
      // The deterministic screen above already caught anything clinical or
      // urgent, consent or no consent — so an unreadable message from someone
      // we have never met is almost always a greeting ("hi", "hello",
      // "namaste"), which is how nearly every WhatsApp conversation opens.
      // Introducing ourselves is the useful reply. Handing a stranger's
      // "hello" to a nurse is not, and it used to happen to every single
      // patient on their very first message. Twice, then a person — counted by
      // the same reask() the rest of the conversation uses, so there is one
      // mechanism to reason about rather than two that can disagree.
      return reask(introduction(ctx.clinic.name),
        "repeatedly unclear, before consent", "consent_requested");
    }
    if (c.intent === "consent_yes") {
      await recordConsent(db, { kind: "agent" }, ctx.patient.id, "granted");
      // Drop the stashed request, keep everything else the conversation knows.
      const { pending, ...rest } = state;
      await setState(db, ctx.conversation.id, rest);
      if (!pending) {
        return { text: "Thank you. What day would you like to come in?",
                 escalated: false, intent: c.intent };
      }
      // Honour what they originally asked for instead of making them repeat it.
      const resumed = await route(
        db, { ...msg, body: pending },
        { ...ctx, patient: { ...ctx.patient, consent_status: "granted" },
          conversation: { ...ctx.conversation, state: rest } },
        now, classify,
      );
      return { ...resumed, text: `Thank you. ${resumed.text}` };
    }
    await setState(db, ctx.conversation.id, { ...state, pending: stash(state, c, msg) });
    return { text: CONSENT_NOTICE, escalated: false, intent: "consent_requested" };
  }

  // A booking with no name attached is not much use to the front desk, so ask
  // once, right after consent. Anything else — reading back an appointment,
  // cancelling — proceeds without it.
  if (!ctx.patient.name && c.intent === "provide_name" && c.name) {
    await setPatientName(db, { kind: "agent" }, ctx.patient.id, c.name);
    // Same as consent: the name question is a detour, not a reset. Anything
    // already collected — the doctor, the day — has to survive it.
    const { pending: stashed, ...rest } = state;
    await setState(db, ctx.conversation.id, rest);
    if (!stashed) {
      return { text: `Thank you, ${c.name}. What day would you like to come in?`,
               escalated: false, intent: c.intent };
    }
    const resumed = await route(
      db, { ...msg, body: stashed },
      { ...ctx, patient: { ...ctx.patient, name: c.name },
        conversation: { ...ctx.conversation, state: rest } },
      now, classify,
    );
    return { ...resumed, text: `Thank you, ${c.name}. ${resumed.text}` };
  }

  if (!ctx.patient.name && (c.intent === "book" || c.intent === "reschedule")) {
    await setState(db, ctx.conversation.id, { ...state, pending: stash(state, c, msg) });
    return { text: "Before I book that — what name should I put on the appointment?",
             escalated: false, intent: "name_requested" };
  }

  // 4. Logistics.
  if (c.intent === "unclear") {
    return reask(outstanding(ctx, state, doctors), "intent unclear");
  }

  if (isBooking(state) && c.intent !== "cancel") {
    return continueBooking(db, ctx, state, c, doctors, now, escalate, reask);
  }

  switch (c.intent) {
    case "book":
      return startBooking(db, msg, ctx, c, doctors, now, escalate, reask);

    case "check_appointment": {
      const rows = await tools.get_upcoming_appointments(db, ctx.patient.id);
      if (rows.length === 0) {
        return { text: "You have no upcoming appointments booked.",
                 escalated: false, intent: c.intent };
      }
      const list = rows.map(r => `• ${r.doctor_name} — ${fmtTime(r.starts_at, ctx.clinic.timezone)}`);
      return { text: `Your upcoming appointments:\n${list.join("\n")}`,
               escalated: false, intent: c.intent };
    }

    case "check_prescription_record": {
      const rows = await tools.get_prescription_summary(db, ctx.patient.id);
      if (rows.length === 0) {
        return { text: "There are no active prescriptions on your record.",
                 escalated: false, intent: c.intent };
      }
      // Read back verbatim. No interpretation, no advice (docs/01).
      const list = rows.map(r =>
        `• ${r.drug_name} — ${r.dosage}` +
        (r.duration_days ? `, ${r.duration_days} days` : "") +
        `, recorded ${dayIn(r.created_at, ctx.clinic.timezone)}`);
      return {
        text: `Your record shows:\n${list.join("\n")}\n\nFor any question about these, ` +
              `please speak to the clinic team.`,
        escalated: false, intent: c.intent,
      };
    }

    case "cancel": {
      const rows = await tools.get_upcoming_appointments(db, ctx.patient.id);
      if (rows.length === 0) {
        await clearState(db, ctx.conversation.id);
        return { text: "You have no upcoming appointments to cancel.",
                 escalated: false, intent: c.intent };
      }
      if (rows.length > 1) {
        return escalate("cancel request with several upcoming appointments", "normal",
          "You have more than one upcoming appointment, so I have asked the clinic team " +
          "to help you cancel the right one.", c.intent);
      }
      await tools.cancel_appointment(db, { appointmentId: rows[0].id, patientId: ctx.patient.id });
      await clearState(db, ctx.conversation.id);
      return {
        text: `Cancelled: ${rows[0].doctor_name} on ${fmtTime(rows[0].starts_at, ctx.clinic.timezone)}.`,
        escalated: false, intent: c.intent,
      };
    }

    case "reschedule": {
      const rows = await tools.get_upcoming_appointments(db, ctx.patient.id);
      if (rows.length !== 1) {
        return escalate(`reschedule request with ${rows.length} upcoming appointments`, "normal",
          "I have asked the clinic team to help you move your appointment.", c.intent);
      }
      const [appt] = await db<{ doctor_id: string }[]>`
        select doctor_id from appointments where id = ${rows[0].id}`;
      const next: BookingState = {
        flow: "booking", step: "awaiting_day", doctorId: appt.doctor_id,
        reason: "reschedule", reschedulingId: rows[0].id,
      };
      if (c.day) return offerSlots(db, ctx, next, c.day, now);
      await setState(db, ctx.conversation.id, next);
      return { text: "Sure — what day would you like to move it to?",
               escalated: false, intent: c.intent };
    }

    default:
      // 5. No tool fits this message. Ask again for what we are waiting on
      //    rather than spending a person on it (docs/05 keeps the handover for
      //    a conversation that is actually stuck — see reask above).
      return reask(outstanding(ctx, state, doctors), "no tool fits the request");
  }
}

type Escalate = (r: string, p: "normal" | "emergency", t: string, i?: string) => Promise<Routed>;
type Reask = (question: string, reason: string, intent?: string,
              keep?: ConversationState) => Promise<Routed>;
type Doctor = { id: string; name: string };

/**
 * The question the patient still owes us an answer to. Re-asking it is the
 * reply to anything we could not read: repeating a question costs one message,
 * where handing over costs the patient everything they had told us so far.
 */
function outstanding(ctx: Ctx, state: ConversationState, doctors: Doctor[]): string {
  if (!isBooking(state)) {
    // Nothing is in flight, so there is no question to repeat and nothing to
    // apologise for — just say what this desk can do.
    return "Happy to help — tell me when you would like to come in and I will " +
           "find you a time. You can also ask about an appointment you already " +
           "have, or reply CANCEL to cancel it.";
  }
  if (state.step === "awaiting_slot" && state.offered?.length) {
    return timesText(state.offered, ctx.clinic.timezone);
  }
  if (state.step === "awaiting_doctor" || !state.doctorId) {
    return whichDoctor(doctors);
  }
  return "Which day would suit you? You can say a date, or something like " +
         "\"tomorrow\" or \"Friday\".";
}

const whichDoctor = (doctors: Doctor[]) =>
  `Which doctor would you like to see? We have ${doctors.map(d => d.name).join(", ")}.`;

async function startBooking(
  db: Db, msg: InboundMessage, ctx: Ctx, c: Classification,
  doctors: Doctor[], now: Date, escalate: Escalate, reask: Reask,
): Promise<Routed> {
  if (doctors.length === 0) {
    return escalate("no doctors configured for this clinic", "normal",
      templates.technicalFailure());
  }

  const doctor = doctors.find(d => d.name === c.doctor)
    ?? (doctors.length === 1 ? doctors[0] : null);

  if (!doctor) {
    // Never assume which doctor they meant — an appointment with the wrong one
    // is worse than an extra question (docs/08: no tool call on guessed data).
    // A day given in the same breath is kept, not dropped: asking for it again
    // two turns later is how the patient ends up repeating themselves.
    await setState(db, ctx.conversation.id, {
      flow: "booking", step: "awaiting_doctor", doctorId: null,
      reason: msg.body, day: c.day ?? undefined,
    });
    return { text: whichDoctor(doctors), escalated: false, intent: "book" };
  }

  const state: BookingState = {
    flow: "booking", step: "awaiting_day", doctorId: doctor.id, reason: msg.body,
  };
  if (c.time && outsideHours(c.time) && !c.day) {
    await setState(db, ctx.conversation.id, state);
    return { text: `${clinicHours()} What day works for you to see ${doctor.name}?`,
             escalated: false, intent: "book" };
  }
  if (c.day) return offerSlots(db, ctx, state, c.day, now);

  await setState(db, ctx.conversation.id, state);
  return { text: `Sure. What day works for you to see ${doctor.name}?`,
           escalated: false, intent: "book" };
}

async function continueBooking(
  db: Db, ctx: Ctx, state: BookingState, c: Classification,
  doctors: Doctor[], now: Date, escalate: Escalate, reask: Reask,
): Promise<Routed> {
  if (state.step === "awaiting_doctor" || !state.doctorId) {
    // A day named before the doctor question is answered still counts, whether
    // this message answers that question or not.
    const day = c.day ?? state.day;
    const doctor = doctors.find(d => d.name === c.doctor);
    if (!doctor) {
      return reask(whichDoctor(doctors),
        "patient did not identify which doctor they wanted", "unclear", { day });
    }
    const next: BookingState = { ...state, step: "awaiting_day", doctorId: doctor.id };
    if (day) return offerSlots(db, ctx, next, day, now);
    await setState(db, ctx.conversation.id, next);
    return { text: `What day works for you to see ${doctor.name}?`,
             escalated: false, intent: "book" };
  }

  if (state.step === "awaiting_slot" && state.offered?.length) {
    if (c.slotIndex === null) {
      // A time we could never book is worth saying out loud. Re-showing the
      // same list is what the patient already could not find their time in.
      if (c.time && outsideHours(c.time)) {
        return {
          text: timesText(state.offered, ctx.clinic.timezone, clinicHours()),
          escalated: false, intent: "book",
        };
      }
      // The classifier is instructed to return null rather than guess; a day
      // given here means they changed their mind about the day.
      if (c.day) return offerSlots(db, ctx, state, c.day, now);
      return reask(timesText(state.offered, ctx.clinic.timezone),
        "could not tell which offered slot the patient chose");
    }
    const picked = new Date(state.offered[c.slotIndex]);
    try {
      const appt = state.reschedulingId
        ? await tools.reschedule_appointment(db, {
            appointmentId: state.reschedulingId, patientId: ctx.patient.id, startsAt: picked,
          }, now)
        : await tools.book_appointment(db, {
            patientId: ctx.patient.id, doctorId: state.doctorId,
            startsAt: picked, reasonText: state.reason,
          }, now);
      await clearState(db, ctx.conversation.id);
      const doctorName = doctors.find(d => d.id === state.doctorId)?.name;
      return {
        text: `You are booked${doctorName ? ` with ${doctorName}` : ""} for ` +
              `${fmtTime(appt.startsAt, ctx.clinic.timezone)}.` +
              (appt.reminderScheduled ? " We will send a reminder the day before." : "") +
              " Reply CANCEL anytime to cancel.",
        escalated: false, intent: "book",
      };
    } catch (e) {
      if (e instanceof BookingError && e.code === "slot_taken") {
        // Someone took it between offering and confirming. Re-offer, don't fail.
        return offerSlots(db, ctx, state, dayIn(picked, ctx.clinic.timezone), now,
          "Sorry, that slot was just taken.");
      }
      if (e instanceof ConsentRequired) throw e;
      return escalate(`booking failed: ${(e as Error).message}`, "normal",
        templates.technicalFailure(), "book");
    }
  }

  if (!c.day) {
    if (c.time && outsideHours(c.time)) {
      return { text: `${clinicHours()} What day would suit you?`,
               escalated: false, intent: "book" };
    }
    return { text: "Which day would suit you? You can say a date, or something like " +
                   "\"tomorrow\" or \"Friday\".", escalated: false, intent: "book" };
  }
  return offerSlots(db, ctx, state, c.day, now);
}

async function offerSlots(
  db: Db, ctx: Ctx, state: BookingState, day: string, now: Date, prefix = "",
): Promise<Routed> {
  const slots = spread(await tools.check_availability(db, state.doctorId!, day, now), 4);
  // The day has been acted on either way; holding it any longer would let a
  // stale answer resurface behind a later question.
  if (slots.length === 0) {
    await setState(db, ctx.conversation.id,
      { ...state, step: "awaiting_day", offered: [], day: undefined });
    return {
      text: `${prefix} There is nothing free that day. What other day would work?`.trim(),
      escalated: false, intent: "book",
    };
  }
  const offered = slots.map(s => s.startsAt.toISOString());
  await setState(db, ctx.conversation.id,
    { ...state, step: "awaiting_slot", offered, day: undefined });
  return {
    text: timesText(offered, ctx.clinic.timezone, prefix),
    escalated: false, intent: "book",
  };
}

/**
 * Pick `n` times spread across the day rather than the first `n`.
 *
 * Offering the four earliest slots means a patient who wants an afternoon
 * appointment sees four morning times, cannot pick any of them, and gets
 * escalated to the human this system exists to spare — so the offer has to
 * cover the shape of the day.
 */
function spread<T>(all: T[], n: number): T[] {
  if (all.length <= n) return all;
  const step = (all.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => all[Math.round(i * step)]);
}

/** Which request to hold while we collect consent or a name. A vaguer message
 *  ("1") must not replace the real one, but a correction that names a doctor or
 *  a day ("actually Dr. Iyer on Friday") is the patient's new request. */
const stash = (state: ConversationState, c: Classification, msg: InboundMessage) =>
  c.doctor || c.day ? msg.body : (state.pending ?? msg.body);

/** Was the last thing we said to this patient the consent notice? Both the
 *  notice reply and introduction() end with it. */
async function justAskedForConsent(db: Db, conversationId: string) {
  const [last] = await db<{ body: string }[]>`
    select body from messages
     where conversation_id = ${conversationId} and direction = 'outbound'
     order by created_at desc limit 1`;
  return !!last?.body.endsWith(CONSENT_NOTICE);
}

const setState = (db: Db, id: string, state: ConversationState) =>
  db`update conversations set state = ${db.json(state)} where id = ${id}`;

const clearState = (db: Db, id: string) =>
  db`update conversations set state = '{}'::jsonb where id = ${id}`;

/** Find or create the patient and conversation this message belongs to. */
async function context(db: Db, msg: InboundMessage): Promise<Ctx> {
  const [clinic] = await db<
    { id: string; name: string; timezone: string; phone: string }[]>`
    select id, coalesce(name, 'the clinic') as name, timezone,
           coalesce(phone, 'the clinic') as phone
      from clinics where id = ${msg.clinicId}`;
  if (!clinic) throw new Error(`unknown clinic ${msg.clinicId}`);

  // First contact creates the patient row; a returning patient just reads back.
  // `do nothing` rather than `do update` so the agent needs no UPDATE grant on
  // the identity columns (docs/08).
  await db`insert into patients (clinic_id, phone) values (${msg.clinicId}, ${msg.phone})
           on conflict (clinic_id, phone) do nothing`;
  const [patient] = await db<{ id: string; consent_status: string; name: string | null }[]>`
    select id, consent_status, name from patients
     where clinic_id = ${msg.clinicId} and phone = ${msg.phone}`;

  // One conversation per patient per channel, enforced by a unique index — two
  // webhook deliveries racing on a first message used to create two, after which
  // booking state was picked arbitrarily and could be lost mid-flow.
  await db`insert into conversations (patient_id, channel) values (${patient.id}, 'whatsapp')
           on conflict (patient_id, channel) do nothing`;
  const [conversation] = await db<{ id: string; state: ConversationState }[]>`
    select id, state from conversations
     where patient_id = ${patient.id} and channel = 'whatsapp'`;

  return { clinic, patient, conversation };
}

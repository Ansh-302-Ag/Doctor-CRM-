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
import type { Db } from "../db";
import { tools } from "./tools";
import { screen, templates } from "./screen";
import {
  classifyWithClaude, ClassifierUnavailable,
  type Classifier, type Classification,
} from "./intent";
import { CONSENT_NOTICE, recordConsent, withdrawAndDelete, ConsentRequired } from "../consent";
import { BookingError } from "../booking";

export type Reply = { text: string; escalated: boolean };

type BookingState = {
  flow: "booking";
  step: "awaiting_doctor" | "awaiting_day" | "awaiting_slot";
  doctorId: string | null;
  reason?: string;
  offered?: string[];          // ISO instants, in the order shown to the patient
};
/** What the patient asked for before we stopped to collect consent, so the
 *  request can be honoured rather than dropped once they agree. */
type PendingState = { pending: string };
type ConversationState = BookingState | PendingState | Record<string, never>;

const isBooking = (s: ConversationState): s is BookingState =>
  "flow" in s && s.flow === "booking";
const isPending = (s: ConversationState): s is PendingState => "pending" in s;

const fmtTime = (at: Date, tz: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, weekday: "short", day: "numeric", month: "short",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).format(at);

const dayIn = (at: Date, tz: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(at);

const weekdayIn = (at: Date, tz: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long" }).format(at);

export type InboundMessage = {
  clinicId: string;
  phone: string;
  body: string;
  providerMessageId: string;
};

/**
 * Handle one inbound message. Returns the reply to send, or null when the
 * message was a duplicate delivery and must be a no-op.
 *
 * `classify` is the model call; it is a parameter so tests can drive the state
 * machine deterministically without a network round trip per assertion.
 */
export async function handleInbound(
  db: Db,
  msg: InboundMessage,
  now = new Date(),
  classify: Classifier = classifyWithClaude,
): Promise<Reply | null> {
  // 1. Dedupe. The unique index on provider_message_id is the real guard;
  //    this check just avoids doing the work twice in the common case.
  const [seen] = await db`select 1 from messages
                           where provider_message_id = ${msg.providerMessageId}`;
  if (seen) return null;

  const ctx = await context(db, msg);

  try {
    await db`insert into messages (conversation_id, direction, body, provider_message_id)
             values (${ctx.conversation.id}, 'inbound', ${msg.body}, ${msg.providerMessageId})`;
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return null;   // raced duplicate
    throw e;
  }
  await db`update conversations set last_message_at = now() where id = ${ctx.conversation.id}`;

  const reply = await route(db, msg, ctx, now, classify);

  await db`insert into messages (conversation_id, direction, body, intent_classified)
           values (${ctx.conversation.id}, 'outbound', ${reply.text}, ${reply.intent ?? null})`;
  return { text: reply.text, escalated: reply.escalated };
}

type Ctx = {
  clinic: { id: string; timezone: string; phone: string };
  patient: { id: string; consent_status: string };
  conversation: { id: string; state: ConversationState };
};
type Routed = { text: string; escalated: boolean; intent?: string };

async function route(
  db: Db, msg: InboundMessage, ctx: Ctx, now: Date, classify: Classifier,
): Promise<Routed> {
  const escalate = async (
    reason: string, priority: "normal" | "emergency", text: string, intent?: string,
  ): Promise<Routed> => {
    await tools.escalate_to_human({
      db, conversationId: ctx.conversation.id, patientId: ctx.patient.id, reason, priority,
    });
    await clearState(db, ctx.conversation.id);
    return { text, escalated: true, intent };
  };

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

  let c: Classification;
  try {
    c = await classify({
      body: msg.body,
      doctors: doctors.map(d => d.name),
      offered: offeredIso.map(iso => fmtTime(new Date(iso), ctx.clinic.timezone)),
      today: dayIn(now, ctx.clinic.timezone),
      weekday: weekdayIn(now, ctx.clinic.timezone),
    });
  } catch (e) {
    // docs/08: the model being down never drops a message silently.
    if (!(e instanceof ClassifierUnavailable)) throw e;
    return escalate(`classifier unavailable: ${e.message}`, "normal",
      templates.technicalFailure(), "classifier_unavailable");
  }

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
    if (c.intent === "consent_yes") {
      await recordConsent(db, { kind: "agent" }, ctx.patient.id, "granted");
      await clearState(db, ctx.conversation.id);
      const pending = isPending(state) ? state.pending : null;
      if (!pending) {
        return { text: "Thank you. What day would you like to come in?",
                 escalated: false, intent: c.intent };
      }
      // Honour what they originally asked for instead of making them repeat it.
      const resumed = await route(
        db, { ...msg, body: pending },
        { ...ctx, patient: { ...ctx.patient, consent_status: "granted" },
          conversation: { ...ctx.conversation, state: {} } },
        now, classify,
      );
      return { ...resumed, text: `Thank you. ${resumed.text}` };
    }
    await setState(db, ctx.conversation.id, { pending: msg.body });
    return { text: CONSENT_NOTICE, escalated: false, intent: "consent_requested" };
  }

  // 4. Logistics.
  if (isBooking(state) && c.intent !== "cancel") {
    return continueBooking(db, ctx, state, c, doctors, now, escalate);
  }

  switch (c.intent) {
    case "book":
      return startBooking(db, msg, ctx, c, doctors, now, escalate);

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
        `, recorded ${r.created_at.toISOString().slice(0, 10)}`);
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
        flow: "booking", step: "awaiting_day", doctorId: appt.doctor_id, reason: "reschedule",
      };
      if (c.day) return offerSlots(db, ctx, next, c.day, now);
      await setState(db, ctx.conversation.id, next);
      return { text: "Sure — what day would you like to move it to?",
               escalated: false, intent: c.intent };
    }

    default:
      // 5. No tool fits. The only remaining path is a human (docs/05).
      return escalate("intent unclear", "normal", templates.unclear(), "unclear");
  }
}

type Escalate = (r: string, p: "normal" | "emergency", t: string, i?: string) => Promise<Routed>;
type Doctor = { id: string; name: string };

async function startBooking(
  db: Db, msg: InboundMessage, ctx: Ctx, c: Classification,
  doctors: Doctor[], now: Date, escalate: Escalate,
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
    await setState(db, ctx.conversation.id,
      { flow: "booking", step: "awaiting_doctor", doctorId: null, reason: msg.body });
    return {
      text: `Which doctor would you like to see? We have ${doctors.map(d => d.name).join(", ")}.`,
      escalated: false, intent: "book",
    };
  }

  const state: BookingState = {
    flow: "booking", step: "awaiting_day", doctorId: doctor.id, reason: msg.body,
  };
  if (c.day) return offerSlots(db, ctx, state, c.day, now);

  await setState(db, ctx.conversation.id, state);
  return { text: `Sure. What day works for you to see ${doctor.name}?`,
           escalated: false, intent: "book" };
}

async function continueBooking(
  db: Db, ctx: Ctx, state: BookingState, c: Classification,
  doctors: Doctor[], now: Date, escalate: Escalate,
): Promise<Routed> {
  if (state.step === "awaiting_doctor" || !state.doctorId) {
    const doctor = doctors.find(d => d.name === c.doctor);
    if (!doctor) {
      return escalate("patient did not identify which doctor they wanted", "normal",
        "Sorry, I could not tell which doctor you meant. I have asked the clinic " +
        "team to help you book.", "book");
    }
    const next: BookingState = { ...state, step: "awaiting_day", doctorId: doctor.id };
    if (c.day) return offerSlots(db, ctx, next, c.day, now);
    await setState(db, ctx.conversation.id, next);
    return { text: `What day works for you to see ${doctor.name}?`,
             escalated: false, intent: "book" };
  }

  if (state.step === "awaiting_slot" && state.offered?.length) {
    if (c.slotIndex === null) {
      // The classifier is instructed to return null rather than guess; a day
      // given here means they changed their mind about the day.
      if (c.day) return offerSlots(db, ctx, state, c.day, now);
      return escalate("could not tell which offered slot the patient chose", "normal",
        "Sorry, I could not tell which time you meant. I have asked the clinic team to help.",
        "book");
    }
    const picked = new Date(state.offered[c.slotIndex]);
    try {
      const appt = state.reason === "reschedule"
        ? await rescheduleTo(db, ctx, picked, now)
        : await tools.book_appointment(db, {
            patientId: ctx.patient.id, doctorId: state.doctorId,
            startsAt: picked, reasonText: state.reason,
          }, now);
      await clearState(db, ctx.conversation.id);
      return {
        text: `You are booked for ${fmtTime(appt.startsAt, ctx.clinic.timezone)}. ` +
              `We will send a reminder the day before. Reply CANCEL anytime to cancel.`,
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
    return { text: "Which day would suit you? You can say a date, or something like " +
                   "\"tomorrow\" or \"Friday\".", escalated: false, intent: "book" };
  }
  return offerSlots(db, ctx, state, c.day, now);
}

async function offerSlots(
  db: Db, ctx: Ctx, state: BookingState, day: string, now: Date, prefix = "",
): Promise<Routed> {
  const slots = (await tools.check_availability(db, state.doctorId!, day, now)).slice(0, 4);
  if (slots.length === 0) {
    await setState(db, ctx.conversation.id, { ...state, step: "awaiting_day", offered: [] });
    return {
      text: `${prefix} There is nothing free that day. What other day would work?`.trim(),
      escalated: false, intent: "book",
    };
  }
  await setState(db, ctx.conversation.id, {
    ...state, step: "awaiting_slot", offered: slots.map(s => s.startsAt.toISOString()),
  });
  const list = slots.map(s => `• ${fmtTime(s.startsAt, ctx.clinic.timezone)}`).join("\n");
  return {
    text: `${prefix} These times are free:\n${list}\n\nWhich one works?`.trim(),
    escalated: false, intent: "book",
  };
}

async function rescheduleTo(db: Db, ctx: Ctx, startsAt: Date, now: Date) {
  const [current] = await db<{ id: string }[]>`
    select id from appointments
     where patient_id = ${ctx.patient.id} and status = 'booked' and starts_at > now()
     order by starts_at limit 1`;
  return tools.reschedule_appointment(db,
    { appointmentId: current.id, patientId: ctx.patient.id, startsAt }, now);
}

const setState = (db: Db, id: string, state: ConversationState) =>
  db`update conversations set state = ${db.json(state)} where id = ${id}`;

const clearState = (db: Db, id: string) =>
  db`update conversations set state = '{}'::jsonb where id = ${id}`;

/** Find or create the patient and conversation this message belongs to. */
async function context(db: Db, msg: InboundMessage): Promise<Ctx> {
  const [clinic] = await db<{ id: string; timezone: string; phone: string }[]>`
    select id, timezone, coalesce(phone, 'the clinic') as phone
      from clinics where id = ${msg.clinicId}`;
  if (!clinic) throw new Error(`unknown clinic ${msg.clinicId}`);

  // First contact creates the patient row; a returning patient just reads back.
  // `do nothing` rather than `do update` so the agent needs no UPDATE grant on
  // the identity columns (docs/08).
  await db`insert into patients (clinic_id, phone) values (${msg.clinicId}, ${msg.phone})
           on conflict (clinic_id, phone) do nothing`;
  const [patient] = await db<{ id: string; consent_status: string }[]>`
    select id, consent_status from patients
     where clinic_id = ${msg.clinicId} and phone = ${msg.phone}`;

  const [existing] = await db<{ id: string; state: ConversationState }[]>`
    select id, state from conversations
     where patient_id = ${patient.id} and channel = 'whatsapp'
     order by last_message_at desc limit 1`;
  const conversation = existing ?? (await db<{ id: string; state: ConversationState }[]>`
    insert into conversations (patient_id) values (${patient.id}) returning id, state`)[0];

  return { clinic, patient, conversation };
}

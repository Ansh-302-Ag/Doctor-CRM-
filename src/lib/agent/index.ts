/**
 * The agent: a thin orchestrator over a fixed tool set (docs/03, docs/05).
 *
 * Order of business for every inbound message, and it does not vary:
 *   1. dedupe on the provider's message id      (docs/08 — webhook redelivery)
 *   2. deterministic safety screen              (docs/01 — clinical always escalates)
 *   3. consent gate                             (docs/02 — no booking without consent)
 *   4. logistics tool call, or escalate
 *
 * Conversation state lives in the database, never in agent memory, so any
 * instance can pick up any conversation (docs/03).
 */
import type { Db } from "../db";
import { tools } from "./tools";
import { screen, templates, guessIntent, type Intent } from "./screen";
import { parseDay } from "./dates";
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

export type InboundMessage = {
  clinicId: string;
  phone: string;
  body: string;
  providerMessageId: string;
};

/**
 * Handle one inbound message. Returns the reply to send, or null when the
 * message was a duplicate delivery and must be a no-op.
 */
export async function handleInbound(
  db: Db, msg: InboundMessage, now = new Date(),
): Promise<Reply | null> {
  // 1. Dedupe. The unique index on provider_message_id is the real guard;
  //    this check just avoids doing the work twice in the common case.
  const [seen] = await db`select 1 from messages
                           where provider_message_id = ${msg.providerMessageId}`;
  if (seen) return null;

  const { clinic, patient, conversation } = await context(db, msg);

  try {
    await db`insert into messages (conversation_id, direction, body, provider_message_id)
             values (${conversation.id}, 'inbound', ${msg.body}, ${msg.providerMessageId})`;
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return null;   // raced duplicate
    throw e;
  }
  await db`update conversations set last_message_at = now() where id = ${conversation.id}`;

  const reply = await route(db, msg, { clinic, patient, conversation }, now);

  await db`insert into messages (conversation_id, direction, body, intent_classified)
           values (${conversation.id}, 'outbound', ${reply.text}, ${reply.intent ?? null})`;
  return { text: reply.text, escalated: reply.escalated };
}

type Ctx = {
  clinic: { id: string; timezone: string; phone: string };
  patient: { id: string; consent_status: string };
  conversation: { id: string; state: ConversationState };
};

async function route(
  db: Db, msg: InboundMessage, ctx: Ctx, now: Date,
): Promise<{ text: string; escalated: boolean; intent?: string }> {
  const escalate = async (reason: string, priority: "normal" | "emergency", text: string) => {
    await tools.escalate_to_human(db, {
      conversationId: ctx.conversation.id, patientId: ctx.patient.id, reason, priority,
    });
    await clearState(db, ctx.conversation.id);
    return { text, escalated: true, intent: priority === "emergency" ? "emergency_signal" : "clinical_question" };
  };

  // 2. The safety screen runs before any classification and cannot be overridden.
  const verdict = screen(msg.body);
  if (verdict.verdict === "emergency") {
    return escalate(`emergency signal: matched "${verdict.matched}"`, "emergency",
      templates.emergency(ctx.clinic.phone));
  }
  if (verdict.verdict === "clinical") {
    return escalate(`clinical question: matched "${verdict.matched}"`, "normal",
      templates.clinical(ctx.clinic.phone));
  }

  const intent: Intent = guessIntent(msg.body);

  // 3. Consent gate. Nothing proceeds past here without a recorded 'granted'.
  if (intent === "delete_my_data") {
    await withdrawAndDelete(db, { kind: "agent" }, ctx.patient.id);
    return {
      text: "Your consent has been withdrawn and your details are scheduled for deletion. " +
            "Any upcoming appointments have been cancelled.",
      escalated: false, intent: "delete_my_data",
    };
  }
  if (ctx.patient.consent_status !== "granted") {
    const stashed = ctx.conversation.state;
    if (intent === "consent_yes") {
      await recordConsent(db, { kind: "agent" }, ctx.patient.id, "granted");
      await clearState(db, ctx.conversation.id);
      const pending = isPending(stashed) ? stashed.pending : null;
      if (!pending) {
        return { text: "Thank you. What day would you like to come in?",
                 escalated: false, intent: "consent_yes" };
      }
      // Honour what they originally asked for instead of making them repeat it.
      const resumed = await route(
        db, { ...msg, body: pending },
        { ...ctx, patient: { ...ctx.patient, consent_status: "granted" },
          conversation: { ...ctx.conversation, state: {} } },
        now,
      );
      return { ...resumed, text: `Thank you. ${resumed.text}` };
    }
    await setState(db, ctx.conversation.id, { pending: msg.body });
    return { text: CONSENT_NOTICE, escalated: false, intent: "consent_requested" };
  }

  // 4. Logistics.
  const state = ctx.conversation.state as ConversationState;
  if (isBooking(state) && intent !== "cancel") {
    return continueBooking(db, msg, ctx, state, now, escalate);
  }

  switch (intent) {
    case "book":
      return startBooking(db, msg, ctx, now, escalate);

    case "check_appointment": {
      const rows = await tools.get_upcoming_appointments(db, ctx.patient.id);
      if (rows.length === 0) {
        return { text: "You have no upcoming appointments booked.", escalated: false, intent };
      }
      const list = rows.map(r => `• ${r.doctor_name} — ${fmtTime(r.starts_at, ctx.clinic.timezone)}`);
      return { text: `Your upcoming appointments:\n${list.join("\n")}`, escalated: false, intent };
    }

    case "check_prescription_record": {
      const rows = await tools.get_prescription_summary(db, ctx.patient.id);
      if (rows.length === 0) {
        return { text: "There are no active prescriptions on your record.", escalated: false, intent };
      }
      // Read back verbatim. No interpretation, no advice (docs/01).
      const list = rows.map(r =>
        `• ${r.drug_name} — ${r.dosage}` +
        (r.duration_days ? `, ${r.duration_days} days` : "") +
        `, recorded ${r.created_at.toISOString().slice(0, 10)}`);
      return {
        text: `Your record shows:\n${list.join("\n")}\n\nFor any question about these, ` +
              `please speak to the clinic team.`,
        escalated: false, intent,
      };
    }

    case "cancel": {
      const rows = await tools.get_upcoming_appointments(db, ctx.patient.id);
      if (rows.length === 0) {
        await clearState(db, ctx.conversation.id);
        return { text: "You have no upcoming appointments to cancel.", escalated: false, intent };
      }
      if (rows.length > 1) {
        return escalate("cancel request with several upcoming appointments", "normal",
          "You have more than one upcoming appointment, so I have asked the clinic team " +
          "to help you cancel the right one.");
      }
      await tools.cancel_appointment(db, { appointmentId: rows[0].id, patientId: ctx.patient.id });
      await clearState(db, ctx.conversation.id);
      return {
        text: `Cancelled: ${rows[0].doctor_name} on ${fmtTime(rows[0].starts_at, ctx.clinic.timezone)}.`,
        escalated: false, intent,
      };
    }

    case "reschedule": {
      const rows = await tools.get_upcoming_appointments(db, ctx.patient.id);
      if (rows.length !== 1) {
        return escalate(`reschedule request with ${rows.length} upcoming appointments`, "normal",
          "I have asked the clinic team to help you move your appointment.");
      }
      const [doctor] = await db<{ id: string }[]>`
        select doctor_id as id from appointments where id = ${rows[0].id}`;
      await setState(db, ctx.conversation.id,
        { flow: "booking", step: "awaiting_day", doctorId: doctor.id, reason: "reschedule" });
      return { text: "Sure — what day would you like to move it to?", escalated: false, intent };
    }

    default:
      // 5. No tool fits. The only remaining path is a human (docs/05).
      return escalate("intent unclear", "normal", templates.unclear());
  }
}

async function startBooking(
  db: Db, msg: InboundMessage, ctx: Ctx, now: Date,
  escalate: (r: string, p: "normal" | "emergency", t: string) => Promise<{ text: string; escalated: boolean; intent?: string }>,
) {
  const doctors = await db<{ id: string; name: string }[]>`
    select id, name from doctors where clinic_id = ${ctx.clinic.id} order by name`;
  if (doctors.length === 0) {
    return escalate("no doctors configured for this clinic", "normal", templates.technicalFailure());
  }

  const doctor = matchDoctor(msg.body, doctors) ?? (doctors.length === 1 ? doctors[0] : null);
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

  await setState(db, ctx.conversation.id,
    { flow: "booking", step: "awaiting_day", doctorId: doctor.id, reason: msg.body });
  return { text: `Sure. What day works for you to see ${doctor.name}?`, escalated: false, intent: "book" };
}

/** Match on the surname, so "Rao", "dr rao" and "Dr. Rao" all land. */
function matchDoctor(body: string, doctors: { id: string; name: string }[]) {
  const t = body.toLowerCase();
  const hits = doctors.filter(d =>
    t.includes(d.name.toLowerCase().replace(/^dr\.?\s*/i, "")));
  return hits.length === 1 ? hits[0] : null;
}

async function continueBooking(
  db: Db, msg: InboundMessage, ctx: Ctx, state: BookingState, now: Date,
  escalate: (r: string, p: "normal" | "emergency", t: string) => Promise<{ text: string; escalated: boolean; intent?: string }>,
) {
  if (state.step === "awaiting_doctor" || !state.doctorId) {
    const doctors = await db<{ id: string; name: string }[]>`
      select id, name from doctors where clinic_id = ${ctx.clinic.id} order by name`;
    const doctor = matchDoctor(msg.body, doctors);
    if (!doctor) {
      return escalate("patient did not identify which doctor they wanted", "normal",
        "Sorry, I could not tell which doctor you meant. I have asked the clinic " +
        "team to help you book.");
    }
    await setState(db, ctx.conversation.id,
      { ...state, step: "awaiting_day", doctorId: doctor.id });
    return { text: `What day works for you to see ${doctor.name}?`, escalated: false, intent: "book" };
  }

  if (state.step === "awaiting_slot" && state.offered?.length) {
    const picked = pickOffered(msg.body, state.offered, ctx.clinic.timezone);
    if (!picked) {
      return escalate("could not tell which offered slot the patient chose", "normal",
        "Sorry, I could not tell which time you meant. I have asked the clinic team to help.");
    }
    try {
      const appt = state.reason === "reschedule"
        ? await rescheduleTo(db, ctx, picked, now)
        : await tools.book_appointment(db, {
            patientId: ctx.patient.id, doctorId: state.doctorId!,
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
        return offerSlots(db, ctx, state, dayOf(picked, ctx.clinic.timezone), now,
          "Sorry, that slot was just taken.");
      }
      if (e instanceof ConsentRequired) throw e;
      return escalate(`booking failed: ${(e as Error).message}`, "normal", templates.technicalFailure());
    }
  }

  const day = parseDay(msg.body, ctx.clinic.timezone, now);
  if (!day) {
    return { text: "Which day would suit you? You can say a date, or something like " +
                   "\"tomorrow\" or \"Friday\".", escalated: false, intent: "book" };
  }
  return offerSlots(db, ctx, state, day, now);
}

async function offerSlots(
  db: Db, ctx: Ctx, state: BookingState, day: string, now: Date, prefix = "",
) {
  const slots = (await tools.check_availability(db, state.doctorId!, day, now)).slice(0, 4);
  if (slots.length === 0) {
    await setState(db, ctx.conversation.id, { ...state, step: "awaiting_day" });
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

/** Match the patient's reply to one of the times we actually offered.
 *  Never invents a slot — an unmatched reply escalates rather than guessing. */
function pickOffered(body: string, offered: string[], tz: string): Date | null {
  const t = body.toLowerCase().replace(/\s+/g, " ").trim();

  const ordinal = t.match(/\b(first|1st|second|2nd|third|3rd|fourth|4th|last)\b/);
  if (ordinal) {
    const idx = { first: 0, "1st": 0, second: 1, "2nd": 1, third: 2, "3rd": 2,
                  fourth: 3, "4th": 3, last: offered.length - 1 }[ordinal[1]]!;
    return offered[idx] ? new Date(offered[idx]) : null;
  }

  const matches = offered.filter(iso => {
    const at = new Date(iso);
    const h24 = new Intl.DateTimeFormat("en-GB",
      { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
    const [hh, mm] = h24.split(":");
    const h12 = String(((Number(hh) + 11) % 12) + 1);
    const forms = [`${h12}:${mm}`, `${h12}.${mm}`, `${hh}:${mm}`];
    if (mm === "00") forms.push(`${h12} ${Number(hh) < 12 ? "am" : "pm"}`, `${h12}${Number(hh) < 12 ? "am" : "pm"}`);
    return forms.some(f => t.includes(f));
  });
  return matches.length === 1 ? new Date(matches[0]) : null;
}

const dayOf = (at: Date, tz: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(at);

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

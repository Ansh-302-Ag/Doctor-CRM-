/**
 * The inbound-call voice agent's view of the booking engine (Sarvam calls these
 * over HTTP). Same rules as WhatsApp: the agent role, the clinic's hours, the
 * database's no-double-booking constraint, and no booking without consent.
 *
 * Voice models are told to send `date` as YYYY-MM-DD and `time` as 24-hour
 * HH:MM in the clinic's own timezone; anything else is refused, not guessed.
 */
import type { Db, Pool } from "./db";
import { audit } from "./audit";
import { tools } from "./agent/tools";
import {
  BookingError, requireTimezone, OPEN_DAYS, OPEN_HOUR, CLOSE_HOUR, type Slot,
} from "./booking";
import { recordConsent } from "./consent";

const AGENT = { kind: "agent" } as const;
const SEARCH_DAYS = 7;

export class VoiceInputError extends Error {}

type Clinic = { id: string; timezone: string };

async function clinicOf(db: Db, clinicId: string): Promise<Clinic> {
  const [c] = await db<Clinic[]>`select id, timezone from clinics where id = ${clinicId}`;
  if (!c) throw new Error(`unknown clinic ${clinicId}`);
  return c;
}

/** By name if one was given ("Rao" finds "Dr. Rao"), else the clinic's only doctor. */
async function pickDoctor(db: Db, clinicId: string, name?: string) {
  const all = await db<{ id: string; name: string }[]>`
    select id, name from doctors where clinic_id = ${clinicId} order by name`;
  const wanted = name?.toLowerCase().replace(/^dr\.?\s*/, "").trim();
  const hits = wanted ? all.filter(d => d.name.toLowerCase().includes(wanted)) : all;
  if (hits.length === 1) return hits[0];
  throw new VoiceInputError(
    `Which doctor? This clinic has: ${all.map(d => d.name).join(", ")}.`);
}

/** Local wall-clock parts of an instant in the clinic's zone. */
const local = (at: Date, tz: string) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: requireTimezone(tz), year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(at).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
};

const spoken = (at: Date, tz: string) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: tz, weekday: "long", day: "numeric", month: "long",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).format(at);

/** "2026-10-17" → "Saturday, 17 October", so the agent says the date the CRM checked. */
const spokenDay = (day: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" })
    .format(new Date(`${day}T12:00:00Z`));

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

function parseInput(date: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    throw new VoiceInputError("date must be YYYY-MM-DD");
  }
  const t = time.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!t || Number(t[1]) > 23 || Number(t[2]) > 59) {
    throw new VoiceInputError("time must be 24-hour HH:MM");
  }
  return { date, time: `${t[1].padStart(2, "0")}:${t[2]}` };
}

/**
 * What the agent needs at the start of a call, so the CRM stays the source of
 * truth: today's date (to turn "kal" into YYYY-MM-DD), the clinic, its doctors
 * and its hours.
 */
export async function voiceContext(db: Db, clinicId: string, now = new Date()) {
  const [c] = await db<{ name: string; timezone: string }[]>`
    select coalesce(name, 'the clinic') as name, timezone from clinics where id = ${clinicId}`;
  if (!c) throw new Error(`unknown clinic ${clinicId}`);
  const doctors = await db<{ name: string; specialty: string | null }[]>`
    select name, specialty from doctors where clinic_id = ${clinicId} order by name`;
  // A ready-made calendar, because the model miscounts: asked for "Monday" on
  // a Thursday it sent the 18th, a Sunday. Looking a date up beats computing it.
  const today = local(now, c.timezone).date;
  const days = Array.from({ length: 15 }, (_, i) => {
    const day = addDays(today, i);
    const name = spokenDay(day).split(",")[0];
    return `${name} ${day}${OPEN_DAYS.has(name.slice(0, 3)) ? "" : " (closed)"}`;
  });
  return {
    today: `${days[0]}. Coming days: ${days.slice(1).join(", ")}`,
    clinic_name: c.name,
    doctors: doctors.map(d => (d.specialty ? `${d.name} (${d.specialty})` : d.name)).join(", "),
    timings: `${[...OPEN_DAYS].join(", ")}, ${OPEN_HOUR}:00 to ${CLOSE_HOUR}:00`,
  };
}

const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Is the exact slot free? If not, up to three alternatives: the open slots on
 * that day closest to the time asked for, or, if the day is full or closed,
 * the first slots on the next open day within a week.
 */
export async function voiceAvailability(
  db: Db, clinicId: string,
  input: { date: string; time: string; doctor?: string }, now = new Date(),
) {
  const { date, time } = parseInput(input.date, input.time);
  const clinic = await clinicOf(db, clinicId);
  const doctor = await pickDoctor(db, clinicId, input.doctor);
  const tz = clinic.timezone;

  const slots = await tools.check_availability(db, doctor.id, date, now);
  const exact = slots.find(s => local(s.startsAt, tz).time === time);
  if (exact) {
    return {
      available: true, doctor: doctor.name, date, time,
      message: `AVAILABLE: ${doctor.name} is free on ${spoken(exact.startsAt, tz)}.`,
      alternatives: [] as { date: string; time: string; spoken: string }[],
    };
  }

  let alternatives: Slot[] = [...slots]
    .sort((a, b) =>
      Math.abs(toMinutes(local(a.startsAt, tz).time) - toMinutes(time)) -
      Math.abs(toMinutes(local(b.startsAt, tz).time) - toMinutes(time)))
    .slice(0, 3)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  for (let i = 1; !alternatives.length && i <= SEARCH_DAYS; i++) {
    alternatives = (await tools.check_availability(db, doctor.id, addDays(date, i), now)).slice(0, 3);
  }

  const alts = alternatives.map(s => ({ ...local(s.startsAt, tz), spoken: spoken(s.startsAt, tz) }));
  return {
    available: false, doctor: doctor.name, date, time,
    message: `NOT AVAILABLE: ${doctor.name} is not free on ${spokenDay(date)} at ${time}. ` + (alts.length
      ? `The nearest open times are: ${alts.map(a => a.spoken).join("; ")}.`
      : `There are no open times in the week from that day.`),
    alternatives: alts,
  };
}

/** The agent sees only `message`, so a failure has to say so in its first word. */
const notBooked = (check: Awaited<ReturnType<typeof voiceAvailability>>) =>
  ({ booked: false, ...check, message: check.message.replace(/^(NOT )?AVAILABLE: /, "NOT BOOKED: ") });

/** Indian 10-digit numbers get +91; anything else is taken as international. */
export function normalisePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length < 10 || digits.length > 15) throw new VoiceInputError("invalid phone number");
  return `+${digits}`;
}

/**
 * Books the slot, re-checking it first (the caller may have taken a minute to
 * decide). `consent` must be true: the agent reads the notice aloud and the
 * caller agrees before this is called (docs/02) — recorded with channel 'voice'.
 * A slot that is gone answers with alternatives instead of an error.
 *
 * Every write runs in one transaction: a caller who loses the slot to someone
 * else leaves no patient row, consent or name behind.
 */
export async function voiceBook(
  db: Pool, clinicId: string,
  input: { date: string; time: string; doctor?: string; phone: string; name?: string;
           reason?: string; consent: boolean },
  now = new Date(),
) {
  if (input.consent !== true) {
    throw new VoiceInputError("the caller has not agreed to the consent notice");
  }
  const phone = normalisePhone(input.phone);
  const check = await voiceAvailability(db, clinicId, input, now);
  if (!check.available) return notBooked(check);

  const clinic = await clinicOf(db, clinicId);
  const doctor = await pickDoctor(db, clinicId, input.doctor);
  const [{ at }] = await db<{ at: Date }[]>`
    select (${`${check.date} ${check.time}:00`}::text::timestamp at time zone ${clinic.timezone}) as at`;

  try {
    const appt = await db.begin(async tx => {
      await tx`insert into patients (clinic_id, phone) values (${clinicId}, ${phone})
               on conflict (clinic_id, phone) do nothing`;
      const [patient] = await tx<{ id: string; consent_status: string; deleted_at: Date | null }[]>`
        select id, consent_status, deleted_at from patients
         where clinic_id = ${clinicId} and phone = ${phone}`;
      if (patient.consent_status !== "granted" || patient.deleted_at) {
        await recordConsent(tx, AGENT, patient.id, "granted", "voice");
      }
      // A caller's say-so never renames a patient the clinic already knows.
      const name = input.name?.trim();
      if (name) {
        const named = await tx`update patients set name = ${name}
                                where id = ${patient.id} and name is null returning id`;
        if (named.length) await audit(tx, AGENT, "set_patient_name", "patients", patient.id);
      }
      return tools.book_appointment(tx,
        { patientId: patient.id, doctorId: doctor.id, startsAt: at, reasonText: input.reason }, now);
    });
    return {
      booked: true, appointmentId: appt.id, doctor: doctor.name, date: check.date, time: check.time,
      message: `BOOKED: with ${doctor.name} on ${spoken(appt.startsAt, clinic.timezone)}.`,
      alternatives: [],
    };
  } catch (e) {
    if (e instanceof BookingError && e.code === "slot_taken") {
      return notBooked(await voiceAvailability(db, clinicId, input, now));
    }
    throw e;
  }
}

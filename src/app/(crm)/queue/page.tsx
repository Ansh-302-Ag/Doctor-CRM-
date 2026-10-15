import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, CheckCheck, ChevronLeft, ChevronRight, Hourglass, ListOrdered, Phone, Stethoscope } from "lucide-react";
import { validDay } from "@/lib/valid-day";
import { currentStaff } from "@/lib/session";
import { sql } from "@/lib/db";
import { doctorQueue, nextInQueue } from "@/lib/doctor";
import { Hero, greeting } from "@/components/ui/hero";
import { StatTile } from "@/components/ui/stat-tile";
import { Ring } from "@/components/motion/ring";
import { TiltCard } from "@/components/lightswind/tilt-card";
import { BorderBeam } from "@/components/lightswind/border-beam";
import { Reveal } from "@/components/motion/reveal";
import {
  Alert, Avatar, Badge, Card, EmptyState, PageHeader, appointmentStatus,
  btnGhost, btnPrimary, btnSecondary, btnSm, field,
} from "../_ui";
import { VisitActions } from "../appointments/_visit";

/** The screen a doctor works from: his own day, in order, with who is next.
 *  Everyone else's day is on the calendar at "/" — read-only, for context.
 *
 *  Sized to be read from across the desk: the time and the patient's name are
 *  the two things he glances at between consultations, so they are the two
 *  largest things on the row. */
export default async function QueuePage({
  searchParams,
}: { searchParams: Promise<{ day?: string; error?: string }> }) {
  const staff = await currentStaff();
  // Only a doctor has a queue. A receptionist reaching this URL gets a 404
  // rather than a hint that there is something here to find.
  if (staff.role !== "doctor" || !staff.doctorId) notFound();

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: staff.timezone }).format(new Date());
  const { day: rawDay, error } = await searchParams;
  const day = validDay(rawDay, today);

  const rows = await doctorQueue(
    sql, { kind: "staff", id: staff.id }, staff.clinicId, staff.doctorId, day, staff.timezone);

  const now = new Date();
  const next = nextInQueue(rows, now);
  const stats = [
    { label: day === today ? "Today" : "This day", n: rows.length, tone: "accent", icon: CalendarClock },
    { label: "Seen", n: rows.filter(r => r.status === "completed").length, tone: "ok", icon: CheckCheck },
    // Same rule as nextInQueue: booked and not yet started.
    { label: "Still to come", n: rows.filter(r => r.status === "booked" && r.starts_at > now).length, tone: "warn", icon: Hourglass },
  ] as const;
  const others = rows.filter(r => r.id !== next?.id);
  const time = (at: Date) => new Intl.DateTimeFormat("en-GB", {
    timeZone: staff.timezone, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(at);
  const shift = (days: number) =>
    new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  // Format at UTC noon so no timezone can nudge the label onto the day before.
  const dayLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric",
  }).format(new Date(`${day}T12:00:00Z`));

  const step = `${btnSecondary} ${btnSm} !size-9 !p-0`;

  return (
    <section className="space-y-6">
      <Hero
        eyebrow={staff.clinicName}
        title={`${greeting(staff.timezone, now)}, ${staff.name}`}
        timeZone={staff.timezone}
        scene="sphere"
        subtitle={next
          ? <>Next: <span className="font-semibold text-white">{next.patient_name ?? "Unnamed patient"}</span> at {time(next.starts_at)}</>
          : rows.length ? "Nothing still to come on this day." : "Nothing booked with you for this day."}
      >
        <Ring value={stats[1].n} total={rows.length} label="seen" />
      </Hero>

      <PageHeader
        icon={ListOrdered}
        title="My day"
        subtitle={
          <>
            <span className="font-medium text-ink">{dayLabel}</span>
            {day === today && <Badge tone="accent">Today</Badge>}
            <span className="text-ink-3">
              {rows.length} {rows.length === 1 ? "appointment" : "appointments"}
            </span>
          </>
        }
        actions={
          <>
            <div className="flex items-center gap-1">
              <Link href={`/queue?day=${shift(-1)}`} aria-label="Previous day" className={step}>
                <ChevronLeft className="size-4" aria-hidden="true" />
              </Link>
              <Link href="/queue" className={`${btnSecondary} ${btnSm} !h-9`}>Today</Link>
              <Link href={`/queue?day=${shift(1)}`} aria-label="Next day" className={step}>
                <ChevronRight className="size-4" aria-hidden="true" />
              </Link>
            </div>
            <form method="GET" action="/queue" className="flex items-center gap-1">
              <label htmlFor="day" className="sr-only">Go to date</label>
              <input
                id="day"
                type="date"
                name="day"
                required
                defaultValue={day}
                className={`${field} !mt-0 !h-9 !w-auto !py-1.5`}
              />
              <button className={`${btnSecondary} ${btnSm} !h-9`}>Go</button>
            </form>
          </>
        }
      />

      <div className="space-y-3">
        <Reveal className="grid grid-cols-3 gap-3">
          {stats.map(x => <StatTile key={x.label} label={x.label} value={x.n} tone={x.tone} icon={x.icon} />)}
        </Reveal>
        <p className="text-sm">
          <Link href={`/?day=${day}`} className="font-medium text-accent hover:text-accent-hover hover:underline">
            See the whole clinic&rsquo;s day &rarr;
          </Link>
        </p>
      </div>

      {error && <Alert>{error}</Alert>}

      {rows.length === 0 ? (
        <EmptyState title="Nothing booked with you for this day" />
      ) : (
        <>
        {next ? (
          <TiltCard max={3} className="rounded-2xl border border-accent-line bg-gradient-to-br from-surface via-surface to-accent-soft/70 p-4 shadow-pop sm:p-6">
            <BorderBeam />
            <span className="bg-brand inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold text-white shadow-glow">
              <span aria-hidden="true" className="size-1.5 animate-ping rounded-full bg-white" />
              Next patient
            </span>
            <div className="mt-4 flex flex-wrap items-start gap-x-6 gap-y-4">
              <div className="shrink-0">
                <span className="block text-4xl font-semibold leading-none tabular-nums text-ink">
                  {time(next.starts_at)}
                </span>
                <span className="mt-1.5 block text-xs tabular-nums text-ink-3">
                  to {time(next.ends_at)}
                </span>
              </div>
              <div className="flex min-w-0 flex-1 basis-64 gap-3">
                <Avatar name={next.patient_name} size="lg" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/patients/${next.patient_id}`}
                      className="min-w-0 break-words text-xl font-semibold text-ink transition-colors hover:text-accent"
                    >
                      {next.patient_name ?? "Unnamed patient"}
                    </Link>
                    {next.arrived_at && <Badge tone="ok">Arrived</Badge>}
                  </div>
                  <a
                    href={`tel:${next.patient_phone}`}
                    className="mt-0.5 inline-flex items-center gap-1.5 text-sm tabular-nums text-ink-2 hover:text-accent"
                  >
                    <Phone className="size-3.5 text-ink-3" aria-hidden="true" />
                    {next.patient_phone}
                  </a>
                  <p className="mt-3 break-words rounded-lg bg-subtle px-3 py-2 text-sm text-ink-2">
                    <span className="text-ink-3">Reason (as given):</span>{" "}
                    {next.reason_text ?? "—"}
                  </p>
                  <div className="mt-3">
                    <VisitActions a={next} from="queue" day={day} now={now} />
                  </div>
                </div>
              </div>
              <Link href={`/patients/${next.patient_id}#prescribe`} className={`${btnPrimary} max-sm:w-full`}>
                <Stethoscope className="size-4" aria-hidden="true" /> Open record &amp; prescribe
              </Link>
            </div>
          </TiltCard>
        ) : (
          <Alert tone="ok">
            {day === today ? "That's everyone for today." : "Nothing still to come on this day."}
          </Alert>
        )}

        {others.length > 0 && (
          <Card title={next ? "The rest of the day" : "Appointments"} icon={CalendarClock} bodyClassName="">
            <Reveal as="ol" className="divide-y divide-line">
              {others.map(r => {
                const status = appointmentStatus(r.status);
                return (
                  <li key={r.id} className="flex items-start gap-4 px-4 py-4 sm:gap-5 sm:px-5">
                    {/* The clock reading is the anchor: biggest thing on the row. */}
                    <div className="w-14 shrink-0 sm:w-20">
                      <span className={`block text-xl font-semibold leading-none tabular-nums sm:text-2xl ${r.status === "booked" ? "text-ink" : "text-ink-3"}`}>
                        {time(r.starts_at)}
                      </span>
                      <span className="mt-1 block text-xs tabular-nums text-ink-3">
                        to {time(r.ends_at)}
                      </span>
                    </div>

                    <div className="min-w-0 flex-1 border-l border-line pl-4 sm:pl-5">
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                        <Avatar name={r.patient_name} size="sm" />
                        <Link
                          href={`/patients/${r.patient_id}`}
                          className="min-w-0 break-words text-base font-semibold text-ink transition-colors hover:text-accent"
                        >
                          {r.patient_name ?? "Unnamed patient"}
                        </Link>
                        {r.arrived_at && r.status === "booked" && <Badge tone="ok">Arrived</Badge>}
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </div>
                      <a
                        href={`tel:${r.patient_phone}`}
                        className="mt-1 inline-flex items-center gap-1.5 text-sm tabular-nums text-ink-2 hover:text-accent"
                      >
                        <Phone className="size-3.5 text-ink-3" aria-hidden="true" />
                        {r.patient_phone}
                      </a>
                      <p className="mt-1.5 break-words text-sm text-ink-2">
                        <span className="text-ink-3">Reason (as given):</span>{" "}
                        {r.reason_text ?? "—"}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <VisitActions a={r} from="queue" day={day} now={now} />
                        <Link href={`/patients/${r.patient_id}#prescribe`} className={`${btnGhost} ${btnSm}`}>
                          Open record &amp; prescribe
                        </Link>
                      </div>
                    </div>
                  </li>
                );
              })}
            </Reveal>
          </Card>
        )}
        </>
      )}
    </section>
  );
}

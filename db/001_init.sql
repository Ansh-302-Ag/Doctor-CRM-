-- Migration 001: initial schema (docs/04-database-schema.md).
-- Every column here is justified against booking, reminders, or the doctor's record.

create extension if not exists "btree_gist";   -- needed for the appointment exclusion constraint
create extension if not exists "pgcrypto";     -- gen_random_uuid()

create table clinics (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  timezone    text not null,                   -- e.g. 'Asia/Kolkata'
  created_at  timestamptz not null default now()
);

create table doctors (
  id                   uuid primary key default gen_random_uuid(),
  clinic_id            uuid not null references clinics(id) on delete cascade,
  name                 text not null,
  specialty            text,
  default_slot_minutes int not null default 15 check (default_slot_minutes between 5 and 240)
);
create index on doctors (clinic_id);

create type staff_role as enum ('doctor','receptionist','admin');

create table staff_users (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references clinics(id) on delete cascade,
  name          text not null,
  email         text not null unique,
  password_hash text not null,                 -- scrypt; see src/lib/password.ts
  role          staff_role not null,
  doctor_id     uuid references doctors(id),   -- set exactly when role = 'doctor'
  created_at    timestamptz not null default now(),
  constraint doctor_role_has_doctor_row
    check ((role = 'doctor') = (doctor_id is not null))
);
create index on staff_users (clinic_id);

create type consent_status as enum ('pending','granted','withdrawn');

create table patients (
  id                  uuid primary key default gen_random_uuid(),
  clinic_id           uuid not null references clinics(id) on delete cascade,
  name                text,                    -- unknown until the patient tells us
  phone               text not null,           -- also the WhatsApp identity
  consent_status      consent_status not null default 'pending',
  consent_recorded_at timestamptz,
  deleted_at          timestamptz,             -- soft delete; purge job hard-deletes later
  created_at          timestamptz not null default now(),
  unique (clinic_id, phone)
);

create type consent_action as enum ('granted','withdrawn');

create table consent_log (                     -- append-only
  id             uuid primary key default gen_random_uuid(),
  patient_id     uuid not null references patients(id) on delete cascade,
  action         consent_action not null,
  notice_version text not null,
  channel        text not null,
  created_at     timestamptz not null default now()
);
create index on consent_log (patient_id);

create type appointment_status as enum ('booked','rescheduled','cancelled','completed','no_show');

create table appointments (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references clinics(id) on delete cascade,
  doctor_id   uuid not null references doctors(id),
  patient_id  uuid not null references patients(id),
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  status      appointment_status not null default 'booked',
  reason_text text,                            -- raw patient words; never interpreted clinically
  created_by  text not null,                   -- 'agent' or a staff_users.id
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index on appointments (doctor_id, starts_at);
create index on appointments (patient_id, starts_at);

-- Double-booking is structurally impossible, not merely checked in app code (docs/08).
alter table appointments add constraint appointments_no_overlap
  exclude using gist (
    doctor_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status = 'booked');

create type prescription_status as enum ('active','completed','discontinued');

create table prescriptions (
  id             uuid primary key default gen_random_uuid(),
  patient_id     uuid not null references patients(id) on delete cascade,
  doctor_id      uuid not null references doctors(id),
  appointment_id uuid references appointments(id),
  drug_name      text not null,
  dosage         text not null,
  duration_days  int check (duration_days > 0),
  notes          text,
  status         prescription_status not null default 'active',
  created_by     uuid not null references staff_users(id),  -- never the agent, by type
  created_at     timestamptz not null default now()
);
create index on prescriptions (patient_id);

create type reminder_type   as enum ('appointment','refill_followup');
create type reminder_status as enum ('scheduled','sent','failed','cancelled');

create table reminders (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references patients(id) on delete cascade,
  type        reminder_type not null,
  related_id  uuid not null,
  send_at     timestamptz not null,
  sent_at     timestamptz,
  attempts    int not null default 0,
  status      reminder_status not null default 'scheduled'
);
create index on reminders (status, send_at);

create type channel_type as enum ('whatsapp','voice');

create table conversations (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid not null references patients(id) on delete cascade,
  channel         channel_type not null default 'whatsapp',
  started_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  state           jsonb not null default '{}'::jsonb
);
create index on conversations (patient_id);

create type message_direction as enum ('inbound','outbound');

create table messages (
  id                  uuid primary key default gen_random_uuid(),
  conversation_id     uuid not null references conversations(id) on delete cascade,
  direction           message_direction not null,
  body                text not null,
  provider_message_id text unique,             -- webhook dedupe key (docs/08)
  intent_classified   text,
  created_at          timestamptz not null default now()
);
create index on messages (conversation_id, created_at);

create type escalation_status as enum ('open','acknowledged','resolved');

create table escalations (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  patient_id      uuid not null references patients(id) on delete cascade,
  reason          text not null,
  priority        text not null default 'normal',   -- 'normal' | 'emergency'
  status          escalation_status not null default 'open',
  assigned_to     uuid references staff_users(id),
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz
);
create index on escalations (status, created_at);

create table audit_log (                       -- append-only
  id           uuid primary key default gen_random_uuid(),
  actor        text not null,                  -- staff_users.id or 'agent'
  action       text not null,
  target_table text not null,
  target_id    uuid,
  created_at   timestamptz not null default now()
);
create index on audit_log (target_table, target_id, created_at);

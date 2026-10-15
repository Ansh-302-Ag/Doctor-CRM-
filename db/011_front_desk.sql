-- Migration 011: the front desk — arrivals, notes and tasks.
--
-- "Arrived" is a timestamp, not a status: the visit is still `booked` until it
-- is marked completed or no-show, and every reader of `booked` stays correct.
--
-- No grants to clinic_agent: notes and tasks are staff-only. The agent role
-- has no default privileges, so it cannot even select from these tables.

alter table appointments add column arrived_at timestamptz;

-- Front-desk notes on a patient. Append-only by convention: nothing updates them.
create table patient_notes (
  id         uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  body       text not null check (length(trim(body)) > 0),
  created_by uuid not null references staff_users(id),
  created_at timestamptz not null default now()
);
create index on patient_notes (patient_id, created_at);

create table tasks (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references clinics(id) on delete cascade,
  patient_id  uuid references patients(id) on delete cascade,
  title       text not null check (length(trim(title)) > 0),
  due_on      date,
  assigned_to uuid references staff_users(id),
  done_at     timestamptz,
  created_by  uuid not null references staff_users(id),
  created_at  timestamptz not null default now()
);
-- The open-task list: one clinic, not done, soonest first.
create index on tasks (clinic_id, done_at, due_on);
create index on tasks (patient_id);

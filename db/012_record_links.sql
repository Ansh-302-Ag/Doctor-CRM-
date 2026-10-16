-- Migration 012: secure prescription links (src/lib/record-links.ts).
--
-- Prescription content never travels over WhatsApp (Meta Business Messaging
-- Policy). The patient gets a link; the page asks for a one-time code sent to
-- their number. Only hashes of the token and the code are stored.

create table record_links (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid not null references patients(id) on delete cascade,
  token_hash      text not null unique,
  expires_at      timestamptz not null,
  code_hash       text,
  code_expires_at timestamptz,
  wrong_codes     int not null default 0,
  codes_sent_at   timestamptz[] not null default '{}',
  locked_at       timestamptz,
  created_at      timestamptz not null default now()
);
create index on record_links (patient_id);

-- The agent only CREATES links (the "my prescription" reply). Insert alone:
-- it never needs to read a link row back, so it cannot see code state.
grant insert on record_links to clinic_agent;

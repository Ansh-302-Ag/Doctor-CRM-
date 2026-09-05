-- Migration 009: login throttling.
--
-- Deliberately keyed on the submitted email rather than an IP: a clinic's staff
-- share one connection, so an IP lock takes the whole front desk offline while
-- barely inconveniencing an attacker on a phone network. Rows are transient and
-- carry no patient data.
create table login_attempts (
  email        text not null,
  attempted_at timestamptz not null default now()
);
create index login_attempts_email_time on login_attempts (lower(email), attempted_at desc);

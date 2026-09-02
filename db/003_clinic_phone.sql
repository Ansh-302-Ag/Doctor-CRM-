-- Migration 003: the clinic's own phone number.
-- Every escalation reply tells the patient how to reach a human directly
-- (docs/03, docs/05) — that number has to come from somewhere.
alter table clinics add column phone text;

-- Migration 004: let the agent register a first-time caller.
--
-- A patient who messages the clinic for the first time has no row yet, and the
-- agent is the only thing that has met them. It may create the row and fill in
-- the identity/consent columns — and nothing else. In particular it still cannot
-- set deleted_at, so it cannot make a patient disappear.
grant insert (clinic_id, phone, name) on patients to clinic_agent;

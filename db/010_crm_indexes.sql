-- Migration 010: the indexes the CRM's own reads need.
--
-- 001_init.sql indexed the agent's access patterns (by doctor, by patient, by
-- conversation). The staff-facing pages filter by clinic, and none of those
-- filters had an index at all — every patient list, every calendar day and the
-- escalation badge in the header was a sequential scan.

-- Every patient list and search filters on clinic_id (src/lib/patients.ts), and
-- so does the purge job. patients had no index but its primary key.
create index on patients (clinic_id);

-- The calendar's day view: clinic_id equality then a half-open range on
-- starts_at, read in that order (src/app/(crm)/page.tsx). Leading column first,
-- range column second, so the range is a scan of one contiguous slice — which
-- also returns rows already in `order by a.starts_at`.
create index on appointments (clinic_id, starts_at);

-- escalations is joined to patients by patient_id twice on every page load: the
-- open-escalation count in the CRM layout and the list itself. The only index
-- on the table was (status, created_at), which does nothing for that join.
create index on escalations (patient_id);

-- Migration 008: appointments cascade-delete with their patient.
--
-- The DPDP purge job (docs/02, Task 10) hard-deletes a patient row and relies on
-- `on delete cascade` to take their appointments, conversations, messages,
-- prescriptions, reminders and consent-log rows with them. Every other
-- patient_id foreign key already cascades (001_init.sql); appointments was
-- missed, and a purge would otherwise fail outright rather than delete too much.
alter table appointments drop constraint appointments_patient_id_fkey;
alter table appointments add constraint appointments_patient_id_fkey
  foreign key (patient_id) references patients(id) on delete cascade;

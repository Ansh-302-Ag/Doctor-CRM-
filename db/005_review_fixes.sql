-- Migration 005: fixes from the first full code review.
--
-- 1. The agent could not read `reminders`, so cancel, reschedule and
--    delete-my-data all raised 42501 under the production role and committed
--    half their work while telling the patient it had failed.
grant select on reminders to clinic_agent;

-- 2. The DPDP deletion path (consent.ts withdrawAndDelete) is invoked by the
--    agent and must be able to complete. Setting deleted_at is the deletion;
--    withholding it did not protect anyone, it just broke the flow.
grant update (name, consent_status, consent_recorded_at, deleted_at) on patients
  to clinic_agent;

-- 3. staff_users.email is compared case-insensitively at login but was only
--    unique case-sensitively, so 'Rao@x' and 'rao@x' could both exist and the
--    login picked one arbitrarily.
create unique index staff_users_email_lower_key on staff_users (lower(email));

-- 4. Two webhook deliveries racing on a patient's first message could each
--    create a conversation; later messages then picked one arbitrarily and
--    booking state was lost mid-flow.
create unique index conversations_one_per_patient_channel
  on conversations (patient_id, channel);

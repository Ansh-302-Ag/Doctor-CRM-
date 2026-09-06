-- Migration 007: an escalation does not require a conversation.
--
-- A reminder that exhausts its retries must always reach a human (docs/08). The
-- patient it concerns may have been booked at the front desk and never messaged
-- the clinic, so there is no conversation to attach. Requiring one meant those
-- escalations were silently dropped -- the exact failure the retry budget exists
-- to prevent.
alter table escalations alter column conversation_id drop not null;

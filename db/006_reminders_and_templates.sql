-- Migration 006: what the reminder sender needs.

-- Which approved template a reminder will use. Stored rather than derived, so a
-- reminder scheduled under one template still reads correctly if we add another.
alter table reminders add column template_name text;

-- Why the last send failed, so staff see it rather than guessing from logs.
alter table reminders add column last_error text;

-- One scheduled reminder per thing per type. Booking is idempotent (docs/08);
-- scheduling twice for one appointment would message the patient twice.
create unique index reminders_one_per_related
  on reminders (type, related_id) where status = 'scheduled';

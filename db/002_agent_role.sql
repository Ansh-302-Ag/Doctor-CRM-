-- Migration 002: the agent's Postgres role (docs/08 role matrix).
--
-- The point of this file: the agent cannot write to `prescriptions` even if the
-- application layer has a bug. That is a database guarantee, not a code convention.
--
-- :AGENT_PASSWORD is substituted by scripts/migrate.ts from AGENT_DB_PASSWORD.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'clinic_agent') then
    create role clinic_agent login password :AGENT_PASSWORD;
  else
    alter role clinic_agent password :AGENT_PASSWORD;
  end if;
end $$;

grant connect on database current_database_placeholder to clinic_agent;
grant usage on schema public to clinic_agent;

-- Read-only wherever the agent legitimately needs to look.
grant select on
  clinics, doctors, patients, appointments, prescriptions,
  conversations, messages, escalations
  to clinic_agent;

-- Write only where its tools operate (docs/05).
grant insert, update on appointments  to clinic_agent;
grant insert, update on conversations to clinic_agent;
grant insert         on messages      to clinic_agent;
grant insert         on escalations   to clinic_agent;   -- can create, cannot resolve
grant insert         on consent_log   to clinic_agent;
grant insert         on audit_log     to clinic_agent;
grant insert, update on reminders     to clinic_agent;
grant update (name, consent_status, consent_recorded_at) on patients to clinic_agent;

-- Stated explicitly so the guarantee is greppable, not inferred from absence.
revoke insert, update, delete, truncate on prescriptions from clinic_agent;
revoke update, delete on escalations from clinic_agent;
revoke update, delete on audit_log   from clinic_agent;
revoke update, delete on consent_log from clinic_agent;
revoke delete on appointments        from clinic_agent;

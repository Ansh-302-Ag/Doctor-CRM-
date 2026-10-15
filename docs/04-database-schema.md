# Database Schema (v1)

Postgres. Every table below is justified against "does booking,
reminders, or the doctor's record actually need this" — nothing
speculative. IDs are UUIDs. Timestamps are `timestamptz`, always UTC.

## clinics
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| name | text | |
| timezone | text | e.g. `Asia/Kolkata` — needed for correct slot display |
| created_at | timestamptz | |

## doctors
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| clinic_id | uuid FK → clinics | |
| name | text | |
| specialty | text | free text is fine for v1, one clinic = few doctors |
| default_slot_minutes | int | e.g. 15 — used by availability logic |

## staff_users (CRM login accounts — doctor, receptionist, admin)
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| clinic_id | uuid FK | |
| name | text | |
| role | enum('doctor','receptionist','admin') | drives RBAC, see doc 08 |
| auth_id | text | maps to auth provider (e.g. Supabase Auth) user id |
| created_at | timestamptz | |

## patients
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| clinic_id | uuid FK | |
| name | text | |
| phone | text | unique per clinic — this is the WhatsApp identity too |
| consent_status | enum('pending','granted','withdrawn') | see doc 02 |
| consent_recorded_at | timestamptz | nullable |
| created_at | timestamptz | |

## consent_log
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| patient_id | uuid FK | |
| action | enum('granted','withdrawn') | |
| notice_version | text | which consent text version was shown |
| channel | text | e.g. 'whatsapp' | |
| created_at | timestamptz | append-only, never updated |

## appointments
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| clinic_id | uuid FK | |
| doctor_id | uuid FK | |
| patient_id | uuid FK | |
| starts_at | timestamptz | |
| ends_at | timestamptz | |
| status | enum('booked','rescheduled','cancelled','completed','no_show') | |
| reason_text | text | raw patient-entered reason, AI does not interpret it clinically |
| created_by | text | 'agent' or staff_user id — always know who booked it |
| created_at | timestamptz | |
| updated_at | timestamptz | |
| arrived_at | timestamptz | nullable; set by the desk (migration 011). Status stays `booked` until completed / no-show, so every `status = 'booked'` reader is unchanged |

Constraint: no two `booked` appointments for the same `doctor_id` with
overlapping `[starts_at, ends_at)` — enforced at the DB level (exclusion
constraint), not just application logic, to make double-booking
structurally impossible under concurrent requests.

## prescriptions
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| patient_id | uuid FK | |
| doctor_id | uuid FK | |
| appointment_id | uuid FK | nullable — some entries may be added outside a visit |
| drug_name | text | |
| dosage | text | free text, e.g. "500mg twice daily" |
| duration_days | int | nullable |
| notes | text | doctor's own notes, never AI-generated |
| created_by | uuid FK → staff_users | **never 'agent' — enforced at write time** |
| created_at | timestamptz | |
| status | enum('active','completed','discontinued') | drives refill reminders |

Write access to this table is restricted to `doctor` and `receptionist`
roles at the application layer AND the agent's DB role has no INSERT/
UPDATE grant on this table at all (belt and suspenders — see doc 08).

## reminders
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| patient_id | uuid FK | |
| type | enum('appointment','refill_followup') | |
| related_id | uuid | appointment_id or prescription_id depending on type |
| send_at | timestamptz | |
| sent_at | timestamptz | nullable |
| status | enum('scheduled','sent','failed','cancelled') | |

## conversations
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| patient_id | uuid FK | |
| channel | enum('whatsapp','voice') | voice unused in v1 but modeled now to avoid a migration later |
| started_at | timestamptz | |
| last_message_at | timestamptz | |
| state | jsonb | current step in a multi-turn flow, e.g. `{"flow":"booking","step":"awaiting_slot_choice"}` |

## messages
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| conversation_id | uuid FK | |
| direction | enum('inbound','outbound') | |
| body | text | |
| intent_classified | text | nullable, for debugging/auditing the agent's decisions |
| created_at | timestamptz | |

## escalations
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| conversation_id | uuid FK | |
| patient_id | uuid FK | |
| reason | text | why the agent escalated |
| status | enum('open','acknowledged','resolved') | |
| assigned_to | uuid FK → staff_users | nullable until picked up |
| created_at | timestamptz | |
| resolved_at | timestamptz | nullable |

## audit_log
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| actor | text | staff_user id or 'agent' |
| action | text | e.g. 'read_prescription', 'book_appointment' |
| target_table | text | |
| target_id | uuid | |
| created_at | timestamptz | append-only |

## patient_notes (migration 011)
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| patient_id | uuid FK → patients | `on delete cascade` — the purge removes them |
| body | text | non-blank; append-only by convention (no edit, no delete) |
| created_by | uuid FK → staff_users | |
| created_at | timestamptz | |

## tasks (migration 011)
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| clinic_id | uuid FK → clinics | |
| patient_id | uuid FK → patients | nullable (a clinic task); `on delete cascade` |
| title | text | non-blank |
| due_on | date | nullable |
| assigned_to | uuid FK → staff_users | nullable |
| done_at | timestamptz | null while open |
| created_by | uuid FK → staff_users | |
| created_at | timestamptz | |

`clinic_agent` has no grants on either table: notes and tasks are staff-only.
The patient timeline has no table of its own — it is a read-time UNION over
the tables above (`src/lib/timeline.ts`).

## Explicitly deferred (not in v1 schema)

- Insurance/billing tables — out of scope (doc 01)
- Lab report storage — out of scope for v1
- Multi-location clinics — single location per clinic row is enough
  for the pilot; don't build the join table until a real clinic needs it

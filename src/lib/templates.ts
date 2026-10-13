/**
 * WhatsApp message templates.
 *
 * WhatsApp only allows free-form text within 24 hours of the patient's last
 * message. Anything we initiate — a reminder — must use a template approved by
 * Meta in advance. The approved text and this file must agree exactly, so the
 * text lives here once and docs/10-whatsapp-templates.md records what was sent
 * for approval.
 *
 * Templates never carry clinical content (docs/01). A reminder says an event is
 * coming up; it does not tell anyone what to do about their health.
 */
export type TemplateName = "appointment_reminder" | "refill_followup" | "record_updated" | "staff_alert";

export type TemplateSpec = {
  name: TemplateName;
  language: string;
  /** Exactly the body submitted to Meta, with {{1}}-style placeholders. */
  bodyText: string;
  /** Names for those placeholders, in order. */
  params: string[];
};

export const TEMPLATES: Record<TemplateName, TemplateSpec> = {
  appointment_reminder: {
    name: "appointment_reminder",
    language: "en",
    bodyText:
      "Reminder from {{1}}: you have an appointment with {{2}} on {{3}}. " +
      "Reply CANCEL if you can no longer make it.",
    params: ["clinic_name", "doctor_name", "appointment_time"],
  },
  /** Sent when a prescription was recorded outside the 24-hour window, so the
   *  record itself could not be sent (src/lib/doctor.ts). It carries no drug,
   *  no dosage and no instruction — only that there is something to collect —
   *  and the patient's reply reopens the window, after which the agent reads
   *  the record back verbatim. */
  record_updated: {
    name: "record_updated",
    language: "en",
    bodyText:
      "A note from {{1}}: {{2}} added a new entry to your record today. " +
      "Reply to this message to have it read back to you, or call the clinic.",
    params: ["clinic_name", "doctor_name"],
  },
  /** Pages the on-duty staff phone, which is outside the 24-hour window unless
   *  it messaged the number today. Carries no patient detail at all. */
  staff_alert: {
    name: "staff_alert",
    language: "en",
    bodyText:
      "{{1}}: a patient conversation needs a person ({{2}}). " +
      "Please open the escalation inbox in the clinic dashboard.",
    params: ["clinic_name", "priority"],
  },
  refill_followup: {
    name: "refill_followup",
    language: "en",
    bodyText:
      "A note from {{1}}: the course of {{2}} on your record is ending. " +
      "Reply BOOK to arrange a follow-up, or call the clinic.",
    params: ["clinic_name", "drug_name"],
  },
};

export class MissingTemplateParameter extends Error {
  constructor(public param: string, templateName: string) {
    super(`template '${templateName}' requires a '${param}' parameter`);
    this.name = "MissingTemplateParameter";
  }
}

export function renderTemplate(name: TemplateName, params: Record<string, string>) {
  const spec = TEMPLATES[name];
  const parameters = spec.params.map(p => {
    const value = params[p];
    if (value === undefined || value === null || value === "") {
      throw new MissingTemplateParameter(p, name);
    }
    return value;
  });
  const preview = parameters.reduce(
    (text, value, i) => text.replaceAll(`{{${i + 1}}}`, value), spec.bodyText);
  return { name, language: spec.language, parameters, preview };
}

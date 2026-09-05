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
export type TemplateName = "appointment_reminder" | "refill_followup";

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

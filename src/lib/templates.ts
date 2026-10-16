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
export type TemplateName =
  "appointment_reminder" | "refill_followup" | "prescription_ready" | "record_code" | "staff_alert";

export type TemplateSpec = {
  name: TemplateName;
  language: string;
  /** Meta's category. An authentication template is sent with its code twice:
   *  as the body parameter and as the copy-code button's (src/lib/channel.ts). */
  category: "utility" | "authentication";
  /** Exactly the body submitted to Meta, with {{1}}-style placeholders. */
  bodyText: string;
  /** Names for those placeholders, in order. */
  params: string[];
};

export const TEMPLATES: Record<TemplateName, TemplateSpec> = {
  appointment_reminder: {
    name: "appointment_reminder",
    language: "en",
    category: "utility",
    bodyText:
      "Reminder from {{1}}: you have an appointment with {{2}} on {{3}}. " +
      "Reply CANCEL if you can no longer make it.",
    params: ["clinic_name", "doctor_name", "appointment_time"],
  },
  /** A prescription was saved (src/lib/doctor.ts). No health content ever goes
   *  over WhatsApp (Meta's Business Messaging Policy): this says only that
   *  something is ready and where to view it, behind a one-time code. Inside
   *  the 24-hour window the same words go out as free-form text. */
  prescription_ready: {
    name: "prescription_ready",
    language: "en",
    category: "utility",
    bodyText:
      "Hello from {{1}}. {{2}} has added a prescription to your record. " +
      "View it securely here: {{3}} — the page will send a code to this number.",
    params: ["clinic_name", "doctor_name", "link"],
  },
  /** The one-time code for a record link. Meta fixes authentication-template
   *  wording ("{{1}} is your verification code.") and adds the copy-code
   *  button; this text is what Meta renders. */
  record_code: {
    name: "record_code",
    language: "en",
    category: "authentication",
    bodyText: "{{1}} is your verification code.",
    params: ["code"],
  },
  /** Pages the on-duty staff phone, which is outside the 24-hour window unless
   *  it messaged the number today. Carries no patient detail at all. Opens on
   *  fixed words because Meta rejects a body that starts with a variable. */
  staff_alert: {
    name: "staff_alert",
    language: "en",
    category: "utility",
    bodyText:
      "Clinic alert for {{1}}: a patient conversation needs a person ({{2}}). " +
      "Please open the escalation inbox in the clinic dashboard.",
    params: ["clinic_name", "priority"],
  },
  /** Not wired to send yet (src/lib/reminders.ts). Content-free: no drug, no
   *  dose, nothing medical — the patient replies and a person helps. */
  refill_followup: {
    name: "refill_followup",
    language: "en",
    category: "utility",
    bodyText:
      "Hello from {{1}}. {{2}} asked us to check in about your prescription. " +
      "Reply to this message and we will help.",
    params: ["clinic_name", "doctor_name"],
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

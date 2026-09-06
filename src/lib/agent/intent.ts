/**
 * Intent classification and slot filling, via a pluggable LLM provider.
 *
 * This replaces hand-rolled parsing of what the patient typed. It does NOT
 * replace `screen()` — that runs first, deterministically, and its verdict
 * cannot be reached from here (docs/01). By the time this is called the message
 * has already been established as non-clinical.
 *
 * Data minimisation (docs/02): the model sees the message, the clinic's doctor
 * names, the times we just offered, and today's date. Never appointment
 * history, never prescriptions, never anything about other patients.
 *
 * Two providers are supported so this can be exercised with xAI's Grok today
 * and switched to Anthropic for production later with no code change — see
 * `selectProvider` below. Whichever provider answers, its raw tool call is
 * run through the same sanitisation block at the end of `classifyWithClaude`.
 */
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5";
const ENDPOINT = "https://api.anthropic.com/v1/messages";

// xAI's Grok API is OpenAI chat-completions-compatible.
const GROK_ENDPOINT = "https://api.x.ai/v1/chat/completions";
// Confirm this is still xAI's current model name before relying on it — we
// cannot check xAI's docs from here.
const GROK_MODEL = process.env.GROK_MODEL ?? "grok-3";

export const INTENTS = [
  "book", "reschedule", "cancel",
  "check_appointment", "check_prescription_record",
  "consent_yes", "delete_my_data", "provide_name",
  "unclear",
] as const;

export type Intent = (typeof INTENTS)[number];

export type Classification = {
  intent: Intent;
  /** Exactly one of the doctor names supplied, or null. */
  doctor: string | null;
  /** 'YYYY-MM-DD' in the clinic's timezone, or null. */
  day: string | null;
  /** Index into the offered slots, or null. */
  slotIndex: number | null;
  name: string | null;
};

export type ClassifyInput = {
  body: string;
  doctors: string[];
  /** Times already offered to this patient, formatted as they saw them. */
  offered: string[];
  /** Today, in the clinic's timezone, so relative dates resolve correctly. */
  today: string;
  weekday: string;
};

export type Classifier = (input: ClassifyInput) => Promise<Classification>;

export class ClassifierUnavailable extends Error {
  constructor(cause: string) {
    super(`intent classification failed: ${cause}`);
    this.name = "ClassifierUnavailable";
  }
}

const TOOL = {
  name: "record_intent",
  description: "Record what the patient is asking for.",
  input_schema: {
    type: "object",
    properties: {
      intent: {
        type: "string",
        enum: ["book", "reschedule", "cancel", "check_appointment",
               "check_prescription_record", "consent_yes", "delete_my_data",
               "provide_name", "unclear"],
        description:
          "book: wants an appointment. reschedule: move an existing one. " +
          "cancel: cancel one. check_appointment: asking when their appointment is. " +
          "check_prescription_record: asking what is on their prescription record. " +
          "consent_yes: agreeing to the data-storage notice. " +
          "delete_my_data: withdrawing consent or asking to be deleted. " +
          "provide_name: the message is the patient telling us their name. " +
          "unclear: anything else, including anything needing clinical judgement.",
      },
      doctor: {
        type: ["string", "null"],
        description: "Exactly one name from the doctors list, or null if not stated.",
      },
      day: {
        type: ["string", "null"],
        description:
          "The calendar day the patient means, as YYYY-MM-DD, resolved against " +
          "today's date. Null if they did not give one or it is ambiguous.",
      },
      slot_index: {
        type: ["integer", "null"],
        description:
          "Zero-based index into the offered times, if the patient is picking one. " +
          "Null if they are not, or if it is not clear which one they mean.",
      },
      name: {
        type: ["string", "null"],
        description: "The patient's own name, if this message states it. Null otherwise.",
      },
    },
    required: ["intent", "doctor", "day", "slot_index", "name"],
  },
} as const;

const SYSTEM =
  "You route messages for a medical clinic's appointment desk. You handle " +
  "logistics only: booking, rescheduling, cancelling, and reading records back. " +
  "You never give medical advice and never judge urgency — anything needing " +
  "clinical judgement is 'unclear' and goes to a human.\n\n" +
  "Record only what the patient actually said. If you are not confident about " +
  "the day, the doctor, or which time they picked, return null for that field. " +
  "A null costs one extra question; a guess books the wrong appointment.";

/** What both providers hand back before sanitisation — trust the shape, not the values. */
type RawToolCall = {
  intent: Intent; doctor: unknown; day: unknown; slot_index: unknown; name: unknown;
};

type Provider = { name: "anthropic"; key: string } | { name: "grok"; key: string };

/**
 * ANTHROPIC_API_KEY, if set, always wins — a production deployment configured
 * with both keys must never silently fall back to the test provider. Otherwise
 * GROK_API_KEY (for testing). Neither set: no classifier is available.
 */
function selectProvider(): Provider {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) return { name: "anthropic", key: anthropicKey };
  const grokKey = process.env.GROK_API_KEY;
  if (grokKey) return { name: "grok", key: grokKey };
  throw new ClassifierUnavailable("ANTHROPIC_API_KEY is not set");
}

async function callAnthropic(context: string, key: string): Promise<RawToolCall> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 256,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name },
      messages: [{ role: "user", content: context }],
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch((e: Error) => {
    throw new ClassifierUnavailable(e.name === "TimeoutError" ? "timed out" : e.message);
  });

  if (!res.ok) throw new ClassifierUnavailable(`${res.status} ${await res.text()}`);

  const body = await res.json().catch(() => {
    throw new ClassifierUnavailable("response body was not JSON");
  }) as { content: { type: string; name?: string; input?: Record<string, unknown> }[] };
  const call = body.content?.find(c => c.type === "tool_use" && c.name === TOOL.name);
  if (!call?.input) throw new ClassifierUnavailable("no tool call in response");

  return call.input as RawToolCall;
}

// The same TOOL schema Anthropic uses, reshaped into OpenAI's function-calling
// shape — built from TOOL rather than duplicated, so the two can never drift.
const GROK_TOOL = {
  type: "function",
  function: {
    name: TOOL.name,
    description: TOOL.description,
    parameters: TOOL.input_schema,
  },
} as const;

async function callGrok(context: string, key: string): Promise<RawToolCall> {
  const res = await fetch(GROK_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: GROK_MODEL,
      max_tokens: 256,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: context },
      ],
      tools: [GROK_TOOL],
      tool_choice: { type: "function", function: { name: TOOL.name } },
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch((e: Error) => {
    throw new ClassifierUnavailable(e.name === "TimeoutError" ? "timed out" : e.message);
  });

  if (!res.ok) throw new ClassifierUnavailable(`${res.status} ${await res.text()}`);

  const body = await res.json().catch(() => {
    throw new ClassifierUnavailable("response body was not JSON");
  }) as {
    choices?: { message?: { tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[];
  };
  const call = body.choices?.[0]?.message?.tool_calls?.[0];
  if (!call?.function?.arguments) throw new ClassifierUnavailable("no tool call in response");

  // Unlike Anthropic's already-parsed `content[].input`, OpenAI-shaped APIs
  // hand the arguments back as a JSON string.
  try {
    return JSON.parse(call.function.arguments) as RawToolCall;
  } catch {
    throw new ClassifierUnavailable("tool call arguments were not valid JSON");
  }
}

export const classifyWithClaude: Classifier = async (input) => {
  const provider = selectProvider();

  const context = [
    `Today is ${input.weekday} ${input.today}.`,
    input.doctors.length ? `Doctors at this clinic: ${input.doctors.join(", ")}.` : "",
    input.offered.length
      ? `Times just offered to this patient, in order: ${
          input.offered.map((t, i) => `[${i}] ${t}`).join(", ")}.`
      : "",
    `Patient's message: ${JSON.stringify(input.body)}`,
  ].filter(Boolean).join("\n");

  const raw = provider.name === "anthropic"
    ? await callAnthropic(context, provider.key)
    : await callGrok(context, provider.key);

  // Trust the shape, verify the values: a hallucinated doctor or an out-of-range
  // index must become "we don't know", never a wrong booking.
  const intent = (INTENTS as readonly string[]).includes(raw.intent)
    ? raw.intent : "unclear";
  const doctor = typeof raw.doctor === "string" && input.doctors.includes(raw.doctor)
    ? raw.doctor : null;
  // Shape AND validity: "2026-13-45" matches the pattern and is not a date.
  // Letting it through reaches Postgres as an Invalid Date and throws.
  const day = typeof raw.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.day) &&
    !Number.isNaN(Date.parse(`${raw.day}T00:00:00Z`)) &&
    new Date(`${raw.day}T00:00:00Z`).toISOString().startsWith(raw.day)
    ? raw.day : null;
  const slotIndex = Number.isInteger(raw.slot_index) &&
    (raw.slot_index as number) >= 0 && (raw.slot_index as number) < input.offered.length
    ? raw.slot_index as number : null;
  const name = typeof raw.name === "string" && raw.name.trim().length > 0 &&
    raw.name.trim().length <= 80 ? raw.name.trim() : null;

  return { intent, doctor, day, slotIndex, name };
};

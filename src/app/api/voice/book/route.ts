import { handleVoice, str } from "../handle";
import { voiceBook } from "@/lib/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST {date, time, phone, consent: true, doctor?, name?, reason?} → booked, or alternatives. */
export const POST = (req: Request) =>
  handleVoice(req, (db, clinicId, b) => voiceBook(db, clinicId, {
    date: str(b.date) ?? "", time: str(b.time) ?? "", doctor: str(b.doctor),
    phone: str(b.phone) ?? "", name: str(b.name), reason: str(b.reason),
    // Sarvam may send booleans as strings.
    consent: b.consent === true || b.consent === "true",
  }));

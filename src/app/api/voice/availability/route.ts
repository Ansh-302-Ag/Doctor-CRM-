import { handleVoice, str } from "../handle";
import { voiceAvailability } from "@/lib/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST {date: YYYY-MM-DD, time: HH:MM, doctor?} → available, or up to three alternatives. */
export const POST = (req: Request) =>
  handleVoice(req, (db, clinicId, b) => voiceAvailability(db, clinicId,
    { date: str(b.date) ?? "", time: str(b.time) ?? "", doctor: str(b.doctor) }));

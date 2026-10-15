import { handleVoice } from "../handle";
import { voiceContext } from "@/lib/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET → today's date, clinic name, doctors, hours. Called once as a call starts. */
export const GET = (req: Request) => handleVoice(req, (db, clinicId) => voiceContext(db, clinicId));

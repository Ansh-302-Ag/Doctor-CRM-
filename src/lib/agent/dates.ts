/**
 * Turning what a patient typed into a clinic-local calendar day.
 *
 * ponytail: a hand-rolled parser for the handful of phrasings a booking actually
 * uses. Anything it cannot read confidently returns null, and the caller asks
 * again rather than guessing — docs/08 forbids calling a tool with guessed data.
 * The model hook in intent.ts is where "next Tuesday after my usual time" goes
 * when we need it; that is a parsing problem, never a clinical one.
 */
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const dayInTz = (at: Date, tz: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(at);      // YYYY-MM-DD

const weekdayIndexInTz = (at: Date, tz: string) =>
  DAYS.indexOf(new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short" })
    .format(at).toLowerCase().slice(0, 3));

/** Returns 'YYYY-MM-DD' in the clinic's timezone, or null if not confidently readable. */
export function parseDay(text: string, tz: string, now = new Date()): string | null {
  const t = text.toLowerCase().trim();

  const iso = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return iso[0];

  if (/\btoday\b/.test(t)) return dayInTz(now, tz);
  if (/\btomorrow\b/.test(t)) return dayInTz(new Date(now.getTime() + 86_400_000), tz);
  if (/\bday after tomorrow\b/.test(t)) return dayInTz(new Date(now.getTime() + 2 * 86_400_000), tz);

  const named = DAYS.findIndex(d => new RegExp(`\\b${d}(day|s|nes|rs|urs)?\\w*\\b`).test(t));
  if (named >= 0) {
    const todayIdx = weekdayIndexInTz(now, tz);
    let delta = (named - todayIdx + 7) % 7;
    if (delta === 0) delta = 7;                      // "Friday" said on a Friday means next one
    if (/\bnext\b/.test(t) && delta < 7) delta += 7;
    return dayInTz(new Date(now.getTime() + delta * 86_400_000), tz);
  }

  // "12/09" or "12-09-2026", day-first as India writes it.
  const dmy = t.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const year = y ? (y.length === 2 ? `20${y}` : y) : dayInTz(now, tz).slice(0, 4);
    const day = `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    return Number.isNaN(Date.parse(day)) ? null : day;
  }

  return null;
}

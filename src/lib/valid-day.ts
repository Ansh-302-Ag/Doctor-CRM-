/** A ?day= from the URL is user input: accept only a real YYYY-MM-DD, else the
 *  fallback. Postgres rejects ' 00:00'::timestamp and Date throws on junk. */
export function validDay(raw: string | undefined, fallback: string): string {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return fallback;
  const t = Date.parse(`${raw}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === raw ? raw : fallback;
}

"use client";

/** The prescribe form, made quick to fill: drug names this clinic has used
 *  before, chips that write the usual Indian notation into the dosage text,
 *  duration chips, and "Repeat" from an existing row. It still posts exactly
 *  drugName, dosage, durationDays, notes (and doctorId for an admin), one
 *  medicine per submit; every chip only edits text the doctor can see and
 *  change. */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Repeat } from "lucide-react";
import { btnPrimary, btnSecondary, btnSm, field, fieldLabel, fieldHint } from "../../_ui";

export type RxDraft = { drugName: string; dosage: string; durationDays: number | null; notes: string | null };
const REPEAT = "rx:repeat";

const FREQ = ["1-0-0", "0-1-0", "0-0-1", "1-0-1", "1-1-1", "SOS"];
const TIMING = ["after food", "before food"];
const DAYS = [3, 5, 7, 10, 14, 30];
const FREQ_RE = /(^|\s)(?:\d-\d-\d|SOS)(?=\s|$)/i;
const TIMING_RE = /(^|\s)(?:after|before) food(?=\s|$)/i;

const tidy = (s: string) => s.replace(/\s+/g, " ").trim();
/** Put `token` in place of whatever `re` matches (or remove it if it is
 *  already there); frequency goes first, timing last. */
function toggle(dosage: string, re: RegExp, token: string, first: boolean) {
  const m = dosage.match(re);
  if (m && tidy(m[0]).toLowerCase() === token.toLowerCase()) return tidy(dosage.replace(re, " "));
  if (m) return tidy(dosage.replace(re, ` ${token}`));
  return tidy(first ? `${token} ${dosage}` : `${dosage} ${token}`);
}

const chip =
  "inline-flex min-h-10 items-center rounded-lg border px-3 text-sm font-medium tabular-nums transition-colors " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 " +
  "aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent-ink " +
  "border-line-strong bg-surface text-ink-2 hover:border-ink-3 hover:text-ink";

/** "Repeat" on a prescription row: hands the row to the form on this page. */
export function RepeatButton({ rx }: { rx: RxDraft }) {
  return (
    <button
      type="button"
      className={`${btnSecondary} ${btnSm}`}
      onClick={() => window.dispatchEvent(new CustomEvent<RxDraft>(REPEAT, { detail: rx }))}
    >
      <Repeat aria-hidden className="size-3.5" /> Repeat
    </button>
  );
}

export function RxForm({
  action, patientId, doctors, isDoctor, drugNames,
}: {
  action: (form: FormData) => Promise<void>; patientId: string;
  doctors: { id: string; name: string }[]; isDoctor: boolean; drugNames: string[];
}) {
  const [drugName, setDrugName] = useState("");
  const [dosage, setDosage] = useState("");
  const [days, setDays] = useState("");
  const [notes, setNotes] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const drugRef = useRef<HTMLInputElement>(null);
  const dosageRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onRepeat = (e: Event) => {
      const rx = (e as CustomEvent<RxDraft>).detail;
      setDrugName(rx.drugName); setDosage(rx.dosage);
      setDays(rx.durationDays ? String(rx.durationDays) : ""); setNotes(rx.notes ?? "");
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      drugRef.current?.focus({ preventScroll: true });
    };
    window.addEventListener(REPEAT, onRepeat);
    return () => window.removeEventListener(REPEAT, onRepeat);
  }, []);

  const ready = drugName.trim() !== "" && dosage.trim() !== "";
  // Enter in the drug name moves on to the dosage; anywhere else it only
  // submits once both required fields are filled.
  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    const t = e.target as HTMLElement;
    if (e.key !== "Enter" || t.tagName !== "INPUT") return;
    if (t === drugRef.current) { e.preventDefault(); dosageRef.current?.focus(); }
    else if (!ready) e.preventDefault();
  };

  const n = Number(days);
  const review = [
    drugName.trim(), dosage.trim(),
    days.trim() && Number.isInteger(n) && n >= 1 ? `${n} day${n === 1 ? "" : "s"}` : "",
  ].filter(Boolean).join(" · ");

  return (
    <form ref={formRef} action={action} onKeyDown={onKeyDown} id="prescribe"
      className="scroll-mt-4 rounded-xl border border-line bg-surface shadow-card">
      <input type="hidden" name="patientId" value={patientId} />
      <div className="border-b border-line px-4 py-3 sm:px-5">
        <h2 className="text-sm font-semibold text-ink">Add prescription</h2>
        <p className="mt-0.5 text-xs text-ink-3">One medicine per entry.</p>
      </div>
      <div className="space-y-5 p-4 sm:p-5">
        {!isDoctor && (
          <div>
            <label htmlFor="doctorId" className={fieldLabel}>Doctor</label>
            <select id="doctorId" name="doctorId" required className={`${field} min-h-11`}>
              {doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        )}

        <div>
          <label htmlFor="drugName" className={fieldLabel}>Drug name</label>
          <input
            id="drugName" name="drugName" required autoComplete="off" ref={drugRef}
            list={drugNames.length ? "rx-drug-names" : undefined}
            value={drugName} onChange={e => setDrugName(e.target.value)}
            placeholder="e.g. Paracetamol 650 mg" className={`${field} min-h-11 !text-base`}
          />
          {drugNames.length > 0 && (
            <>
              <datalist id="rx-drug-names">
                {drugNames.map(d => <option key={d} value={d} />)}
              </datalist>
              <p className={fieldHint}>Suggestions are names already prescribed at this clinic. Include strength and form.</p>
            </>
          )}
        </div>

        <div>
          <label htmlFor="dosage" className={fieldLabel}>Dosage</label>
          <input
            id="dosage" name="dosage" required autoComplete="off" ref={dosageRef}
            value={dosage} onChange={e => setDosage(e.target.value)}
            placeholder="1 tablet twice daily" aria-describedby="dosage-hint"
            className={`${field} min-h-11 !text-base`}
          />
          <p id="dosage-hint" className={fieldHint}>Tap to fill in; the text stays editable.</p>
          <div role="group" aria-label="Frequency (morning-noon-night)" className="mt-2 flex flex-wrap gap-2">
            {FREQ.map(f => (
              <button key={f} type="button" className={chip}
                aria-pressed={tidy(dosage.match(FREQ_RE)?.[0] ?? "").toLowerCase() === f.toLowerCase()}
                onClick={() => setDosage(d => toggle(d, FREQ_RE, f, true))}>{f}</button>
            ))}
          </div>
          <div role="group" aria-label="Timing" className="mt-2 flex flex-wrap gap-2">
            {TIMING.map(t => (
              <button key={t} type="button" className={chip}
                aria-pressed={tidy(dosage.match(TIMING_RE)?.[0] ?? "").toLowerCase() === t}
                onClick={() => setDosage(d => toggle(d, TIMING_RE, t, false))}>{t}</button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="durationDays" className={fieldLabel}>Duration (days)</label>
          <input
            id="durationDays" name="durationDays" type="number" min={1} step={1} inputMode="numeric"
            value={days} onChange={e => setDays(e.target.value)} placeholder="Optional"
            className={`${field} min-h-11 max-w-40 !text-base`}
          />
          <div role="group" aria-label="Duration presets" className="mt-2 flex flex-wrap gap-2">
            {DAYS.map(d => (
              <button key={d} type="button" className={chip} aria-pressed={days === String(d)}
                onClick={() => setDays(v => (v === String(d) ? "" : String(d)))}>{d} days</button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="notes" className={fieldLabel}>Notes</label>
          <textarea id="notes" name="notes" rows={2} value={notes} onChange={e => setNotes(e.target.value)}
            className={`${field} !text-base`} />
        </div>

        <div aria-live="polite" className="rounded-lg border border-accent-line bg-accent-soft px-3.5 py-3">
          <p className="text-xs font-semibold tracking-wide text-accent-ink">Will be saved as</p>
          {review ? (
            <p className="mt-1 break-words text-sm font-semibold text-ink">{review}</p>
          ) : (
            <p className="mt-1 text-sm text-ink-3">Enter a drug name and dosage.</p>
          )}
          {notes.trim() && <p className="mt-0.5 break-words text-sm text-ink-2">Notes: {notes.trim()}</p>}
        </div>

        <p className="text-xs leading-relaxed text-ink-3">
          Saved exactly as typed, attributed to {isDoctor ? "you" : "the doctor named above"},
          and sent to the patient on WhatsApp as written.
        </p>
        <button className={`${btnPrimary} min-h-11 w-full`}>Save &amp; send to patient</button>
      </div>
    </form>
  );
}

/** A #fragment pointing inside a hidden tab panel: open that tab, then scroll. */
export function HashTab() {
  useEffect(() => {
    const open = () => {
      const el = location.hash.length > 1 ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
      const panel = el?.closest<HTMLElement>("[role=tabpanel]");
      if (!el || !panel) return;
      if (panel.hidden) document.getElementById(panel.getAttribute("aria-labelledby") ?? "")?.click();
      requestAnimationFrame(() => el.scrollIntoView({ block: "start" }));
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  return null;
}

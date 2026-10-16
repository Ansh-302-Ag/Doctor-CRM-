"use client";

/** The prescription pad: every medicine from one sitting, written as a list
 *  and saved together. Drug names this clinic has used before, chips that
 *  write the usual Indian notation into the dosage text, duration chips, and
 *  "Repeat" from an earlier row. It posts drugName, dosage, durationDays and
 *  notes once per medicine, in order (and doctorId for an admin); every chip
 *  only edits text the doctor can see and change. */
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { useFormStatus } from "react-dom";
import { Plus, Repeat, X } from "lucide-react";
import { btnGhost, btnPrimary, btnSecondary, btnSm, field, fieldLabel } from "../../_ui";

export type RxDraft = { drugName: string; dosage: string; durationDays: number | null; notes: string | null };
const REPEAT = "rx:repeat";

const FREQ = ["1-0-0", "0-1-0", "0-0-1", "1-0-1", "1-1-1", "SOS"];
const TIMING = ["after food", "before food"];
const DAYS = [3, 5, 7, 10, 14, 30];
const FREQ_RE = /(^|\s)(?:\d-\d-\d|SOS)(?=\s|$)/i;
const TIMING_RE = /(^|\s)(?:after|before) food(?=\s|$)/i;
const MAX = 20; // MAX_ITEMS in src/lib/doctor.ts

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
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border px-3 text-sm font-medium tabular-nums transition-all active:scale-95 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 " +
  "aria-pressed:border-accent aria-pressed:bg-accent aria-pressed:text-white aria-pressed:shadow-glow " +
  "border-line-strong bg-surface text-ink-2 hover:border-accent-line hover:text-accent-ink";
const input = `${field} min-h-11 !text-base`;

type Row = { key: number; drugName: string; dosage: string; days: string; notes: string; showNotes: boolean };

const blank = (key: number): Row => ({ key, drugName: "", dosage: "", days: "", notes: "", showNotes: false });
const isBlank = (r: Row) => !tidy(r.drugName) && !tidy(r.dosage) && !r.days.trim() && !tidy(r.notes);
const daysOk = (d: string) => d.trim() === "" || (Number.isInteger(Number(d)) && Number(d) >= 1);
/** What is still missing from a row the doctor has started, if anything. */
const missing = (r: Row) =>
  !tidy(r.drugName) ? "a drug name" : !tidy(r.dosage) ? "a dosage" : !daysOk(r.days) ? "a whole number of days" : null;
const daysText = (d: string) => (d.trim() ? `${Number(d)} day${Number(d) === 1 ? "" : "s"}` : "");

/** "Repeat" on a prescription row: hands the row to the pad on this page. */
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
  action, patientId, patientName, today, prescriberName, doctors, isDoctor, drugNames,
}: {
  action: (form: FormData) => Promise<void>; patientId: string; patientName: string;
  today: string; prescriberName: string;
  doctors: { id: string; name: string }[]; isDoctor: boolean; drugNames: string[];
}) {
  const nextKey = useRef(1);
  const [rows, setRows] = useState<Row[]>([blank(0)]);
  const rowsRef = useRef(rows);
  useEffect(() => { rowsRef.current = rows; }, [rows]);
  const focusKey = useRef<number | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);

  const edit = (key: number, patch: (r: Row) => Partial<Row>) =>
    setRows(rs => rs.map(r => (r.key === key ? { ...r, ...patch(r) } : r)));
  const add = (draft?: Partial<Row>) => {
    const key = nextKey.current++;
    setRows(rs => [...rs, { ...blank(key), ...draft }]);
    focusKey.current = key;
  };
  const remove = (key: number) => setRows(rs => (rs.length > 1 ? rs.filter(r => r.key !== key) : [blank(key)]));

  // Focus the drug name of a row just added or filled.
  useEffect(() => {
    if (focusKey.current === null) return;
    document.getElementById(`rx-drug-${focusKey.current}`)?.focus({ preventScroll: true });
    focusKey.current = null;
  }, [rows]);

  // Repeat fills the last row if it is still empty, otherwise adds one.
  useEffect(() => {
    const onRepeat = (e: Event) => {
      const rx = (e as CustomEvent<RxDraft>).detail;
      const draft = {
        drugName: rx.drugName, dosage: rx.dosage, days: rx.durationDays ? String(rx.durationDays) : "",
        notes: rx.notes ?? "", showNotes: Boolean(rx.notes),
      };
      const last = rowsRef.current[rowsRef.current.length - 1];
      if (isBlank(last)) { edit(last.key, () => draft); focusKey.current = last.key; }
      else if (rowsRef.current.length < MAX) add(draft);
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    window.addEventListener(REPEAT, onRepeat);
    return () => window.removeEventListener(REPEAT, onRepeat);
  }, []);

  const filled = rows.filter(r => !isBlank(r));
  const problem = rows.map((r, i) => ({ i, why: isBlank(r) ? null : missing(r) })).find(p => p.why);
  const ready = filled.length > 0 && !problem;

  // Enter never submits: it moves to the next field, and from the last one to
  // the save button, so a half-written row cannot go out by accident.
  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    const t = e.target as HTMLElement;
    if (e.key !== "Enter" || t.tagName !== "INPUT") return;
    e.preventDefault();
    const nav = [...(formRef.current?.querySelectorAll<HTMLElement>("[data-rx-nav]") ?? [])];
    const next = nav[nav.indexOf(t) + 1];
    (next ?? submitRef.current)?.focus();
  };

  const n = filled.length;
  return (
    <form ref={formRef} action={action} onKeyDown={onKeyDown} id="prescribe"
      className="scroll-mt-4 overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      <input type="hidden" name="patientId" value={patientId} />
      {/* What is posted: one set per medicine actually written, in order. */}
      {filled.map(r => (
        <span key={r.key} hidden>
          <input type="hidden" name="drugName" value={tidy(r.drugName)} />
          <input type="hidden" name="dosage" value={tidy(r.dosage)} />
          <input type="hidden" name="durationDays" value={r.days.trim()} />
          <input type="hidden" name="notes" value={tidy(r.notes)} />
        </span>
      ))}

      {/* The pad's head: who, for whom, when. */}
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3 border-b border-line bg-gradient-to-br from-accent-soft via-surface to-sky-soft px-4 py-4 sm:px-5">
        <span aria-hidden="true" className="bg-brand grid size-12 shrink-0 place-items-center rounded-2xl font-serif text-3xl leading-none text-white shadow-glow">&#8478;</span>
        <dl className="grid min-w-0 flex-1 grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <div className="min-w-0">
            <dt className="text-xs text-ink-3">Patient</dt>
            <dd className="truncate font-semibold text-ink">{patientName}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-3">Date</dt>
            <dd className="font-semibold tabular-nums text-ink">{today}</dd>
          </div>
          <div className="col-span-2 min-w-0 sm:col-span-1">
            {isDoctor ? (
              <>
                <dt className="text-xs text-ink-3">Prescribing doctor</dt>
                <dd className="truncate font-semibold text-ink">{prescriberName}</dd>
              </>
            ) : (
              <>
                <dt><label htmlFor="doctorId" className="text-xs text-ink-3">Prescribing doctor</label></dt>
                <dd>
                  <select id="doctorId" name="doctorId" required className={`${field} !mt-0.5 min-h-11`}>
                    {doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </dd>
              </>
            )}
          </div>
        </dl>
      </div>

      {drugNames.length > 0 && (
        <datalist id="rx-drug-names">
          {drugNames.map(d => <option key={d} value={d} />)}
        </datalist>
      )}

      <ol className="divide-y divide-line">
        {rows.map((r, i) => {
          const id = (f: string) => `rx-${f}-${r.key}`;
          const freq = tidy(r.dosage.match(FREQ_RE)?.[0] ?? "").toLowerCase();
          const timing = tidy(r.dosage.match(TIMING_RE)?.[0] ?? "").toLowerCase();
          return (
            <li key={r.key} className="px-4 py-4 transition-colors focus-within:bg-accent-soft/30 sm:px-5">
              <fieldset className="min-w-0">
                <legend className="mb-2 flex w-full items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-ink">
                    <span aria-hidden="true" className="bg-brand mr-1.5 inline-grid size-6 place-items-center rounded-full text-xs font-bold tabular-nums text-white">{i + 1}</span><span className="sr-only">{i + 1}.</span> Medicine
                  </span>
                  {(rows.length > 1 || !isBlank(r)) && (
                    <button type="button" onClick={() => remove(r.key)}
                      className={`${btnGhost} ${btnSm} min-h-11 min-w-11`}
                      aria-label={`Remove medicine ${i + 1}`}>
                      <X aria-hidden className="size-4" />
                      <span className="hidden sm:inline">Remove</span>
                    </button>
                  )}
                </legend>

                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
                  <div className="min-w-0">
                    <label htmlFor={id("drug")} className={fieldLabel}>Drug name</label>
                    <input
                      id={id("drug")} data-rx-nav autoComplete="off"
                      list={drugNames.length ? "rx-drug-names" : undefined}
                      value={r.drugName} onChange={e => edit(r.key, () => ({ drugName: e.target.value }))}
                      placeholder="e.g. Paracetamol 650 mg tablet" className={input}
                    />
                    <p className="mt-1 text-xs text-ink-3">Include strength and form.</p>
                  </div>

                  <div className="min-w-0 lg:row-span-2">
                    <label htmlFor={id("dosage")} className={fieldLabel}>Dosage</label>
                    <input
                      id={id("dosage")} data-rx-nav autoComplete="off"
                      value={r.dosage} onChange={e => edit(r.key, () => ({ dosage: e.target.value }))}
                      placeholder="1 tablet twice daily" className={input}
                    />
                    <div role="group" aria-label={`Frequency (morning-noon-night), medicine ${i + 1}`}
                      className="mt-2 flex flex-wrap gap-1.5">
                      {FREQ.map(f => (
                        <button key={f} type="button" className={chip} aria-pressed={freq === f.toLowerCase()}
                          onClick={() => edit(r.key, x => ({ dosage: toggle(x.dosage, FREQ_RE, f, true) }))}>{f}</button>
                      ))}
                    </div>
                    <div role="group" aria-label={`Timing, medicine ${i + 1}`} className="mt-1.5 flex flex-wrap gap-1.5">
                      {TIMING.map(t => (
                        <button key={t} type="button" className={chip} aria-pressed={timing === t}
                          onClick={() => edit(r.key, x => ({ dosage: toggle(x.dosage, TIMING_RE, t, false) }))}>{t}</button>
                      ))}
                    </div>
                  </div>

                  <div className="min-w-0 lg:col-start-1">
                    <label htmlFor={id("days")} className={fieldLabel}>Duration (days)</label>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <input
                        id={id("days")} data-rx-nav type="number" min={1} step={1} inputMode="numeric"
                        value={r.days} onChange={e => edit(r.key, () => ({ days: e.target.value }))}
                        placeholder="—" aria-invalid={!daysOk(r.days) || undefined}
                        className={`${input} !mt-0 !w-20`}
                      />
                      <div role="group" aria-label={`Duration presets, medicine ${i + 1}`} className="contents">
                        {DAYS.map(d => (
                          <button key={d} type="button" className={chip} aria-pressed={r.days === String(d)}
                            aria-label={`${d} days`}
                            onClick={() => edit(r.key, x => ({ days: x.days === String(d) ? "" : String(d) }))}>
                            {d}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {r.showNotes ? (
                  <div className="mt-3">
                    <label htmlFor={id("notes")} className={fieldLabel}>Instructions</label>
                    <input
                      id={id("notes")} data-rx-nav autoComplete="off"
                      value={r.notes} onChange={e => edit(r.key, () => ({ notes: e.target.value }))}
                      placeholder="e.g. complete the course" className={input}
                    />
                  </div>
                ) : (
                  <button type="button" className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-accent hover:text-accent-hover"
                    onClick={() => { edit(r.key, () => ({ showNotes: true }));
                      requestAnimationFrame(() => document.getElementById(id("notes"))?.focus()); }}>
                    <Plus aria-hidden className="size-4" /> Add instructions
                  </button>
                )}
              </fieldset>
            </li>
          );
        })}
      </ol>

      <div className="border-t border-line px-4 py-3 sm:px-5">
        <button type="button" onClick={() => add()} disabled={rows.length >= MAX}
          className={`${btnSecondary} min-h-11`}>
          <Plus aria-hidden className="size-4" /> Add medicine
        </button>
      </div>

      {/* Exactly what will be stored, in order. */}
      <div aria-live="polite" className="border-t border-accent-line bg-accent-soft/50 px-4 py-4 sm:px-5">
        <h3 className="text-sm font-semibold text-ink">Will be saved as</h3>
        {n === 0 ? (
          <p className="mt-1 text-sm text-ink-3">Write at least one medicine: a drug name and a dosage.</p>
        ) : (
          <ol className="mt-2 space-y-2">
            {filled.map((r, i) => (
              <li key={r.key} className="flex gap-2 text-sm">
                <span className="w-5 shrink-0 tabular-nums text-ink-3">{i + 1}.</span>
                <div className="min-w-0 break-words">
                  <p className="font-semibold text-ink">{tidy(r.drugName) || <span className="text-danger-ink">drug name missing</span>}</p>
                  <p className="text-ink-2">
                    {tidy(r.dosage) || <span className="text-danger-ink">dosage missing</span>}
                    {r.days.trim() && daysOk(r.days) && <span className="text-ink-3"> · {daysText(r.days)}</span>}
                  </p>
                  {tidy(r.notes) && <p className="text-ink-2">{tidy(r.notes)}</p>}
                </div>
              </li>
            ))}
          </ol>
        )}
        {problem && (
          <p className="mt-3 text-sm text-danger-ink">Medicine {problem.i + 1} needs {problem.why}.</p>
        )}
      </div>

      <div className="space-y-3 border-t border-line px-4 py-4 sm:px-5">
        <p className="text-xs leading-relaxed text-ink-3">
          Saved exactly as typed and attributed to {isDoctor ? "you" : "the doctor named above"}.
          The patient gets a secure link on WhatsApp to view and download it — the prescription
          itself is never sent in chat.
        </p>
        <SaveButton buttonRef={submitRef} ready={ready} n={n} />
      </div>
    </form>
  );
}

/** Disabled while the save is in flight, so a double click cannot save and
 *  send the same medicines twice. useFormStatus must sit inside the <form>. */
function SaveButton({ buttonRef, ready, n }: {
  buttonRef: RefObject<HTMLButtonElement | null>; ready: boolean; n: number;
}) {
  const { pending } = useFormStatus();
  return (
    <button ref={buttonRef} disabled={!ready || pending} aria-busy={pending || undefined}
      className={`${btnPrimary} min-h-12 w-full text-base sm:w-auto sm:px-6`}>
      {pending ? "Saving…" : <>Save &amp; notify patient{n > 0 && ` (${n} medicine${n === 1 ? "" : "s"})`}</>}
    </button>
  );
}

/** A #fragment pointing inside a hidden tab panel: open that tab, then scroll. */
export function HashTab() {
  useEffect(() => {
    const open = () => {
      let id = "";
      try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; } // a malformed %-escape
      const el = id ? document.getElementById(id) : null;
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

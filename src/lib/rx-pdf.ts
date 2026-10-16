import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";

// The patient's copy of the record (docs/01): shown exactly as the doctor entered it —
// nothing interpreted, no advice added. Fonts are IBM Plex Sans Devanagari (OFL,
// assets/fonts/OFL.txt): Latin + Devanagari. pdfkit's built-in Helvetica is never loaded.

export type RxPdfInput = {
  clinicName: string; clinicPhone: string | null;
  patientName: string | null; patientPhone: string;
  issuedAt: Date; timezone: string;
  prescriptions: { drugName: string; dosage: string; durationDays: number | null; notes: string | null;
                   doctorName: string; createdAt: Date; status: string }[];
};

const font = (file: string) => fs.readFileSync(path.join(process.cwd(), "assets/fonts", file));
// Read once per process, not per download.
let fonts: { regular: Buffer; semibold: Buffer } | undefined;
const ACCENT = "#0d6e6b";
const INK = "#1a1a1a";
const MUTED = "#5f6368";
const FOOTER_H = 40;

export async function renderPrescriptionPdf(input: RxPdfInput): Promise<Buffer> {
  fonts ??= {
    regular: font("IBMPlexSansDevanagari-Regular.ttf"),
    semibold: font("IBMPlexSansDevanagari-SemiBold.ttf"),
  };
  const { regular, semibold } = fonts;
  const doc = new PDFDocument({
    size: "A5", margin: 36, bufferPages: true,
    // a default font, or pdfkit's constructor loads Helvetica's AFM
    font: path.join(process.cwd(), "assets/fonts", "IBMPlexSansDevanagari-Regular.ttf"),
    info: { Title: "Prescription", Author: input.clinicName, Producer: "Doctor-CRM", Creator: "Doctor-CRM" },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  doc.registerFont("R", regular);
  doc.registerFont("B", semibold);

  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const patient = input.patientName ?? "Patient";
  const rule = (color = ACCENT) => {
    doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(0.75).strokeColor(color).stroke();
  };
  // Content stops above the footer; continuation pages get a one-line header.
  doc.page.margins.bottom = 36 + FOOTER_H;
  doc.on("pageAdded", () => {
    doc.page.margins.bottom = 36 + FOOTER_H;
    doc.font("R").fontSize(8).fillColor(MUTED)
      .text(`${input.clinicName} · ${patient} · continued`, left, doc.page.margins.top, { width });
    doc.moveDown(0.3); rule("#d0d5d8"); doc.moveDown(0.8);
  });

  // Header
  doc.font("B").fontSize(15).fillColor(INK).text(input.clinicName, { width });
  if (input.clinicPhone) doc.font("R").fontSize(9).fillColor(MUTED).text(input.clinicPhone, { width });
  doc.moveDown(0.5); rule(); doc.moveDown(0.8);

  // Patient + date
  const issued = new Intl.DateTimeFormat("en-IN", {
    timeZone: input.timezone, day: "numeric", month: "long", year: "numeric",
  }).format(input.issuedAt);
  const label = (k: string, v: string) => {
    doc.font("R").fontSize(8).fillColor(MUTED).text(k.toUpperCase(), { width, characterSpacing: 0.5 });
    doc.font("B").fontSize(10.5).fillColor(INK).text(v, { width });
    doc.moveDown(0.4);
  };
  const top = doc.y;
  doc.font("R").fontSize(8).fillColor(MUTED).text("PATIENT", { width, characterSpacing: 0.5 });
  doc.font("B").fontSize(10.5).fillColor(INK).text(patient, { width: width * 0.6 });
  doc.font("R").fontSize(9.5).text(input.patientPhone, { width: width * 0.6 });
  const afterPatient = doc.y;
  doc.font("R").fontSize(8).fillColor(MUTED)
    .text("DATE ISSUED", left, top, { width, align: "right", characterSpacing: 0.5 });
  doc.font("B").fontSize(10.5).fillColor(INK).text(issued, { width, align: "right" });
  doc.x = left; doc.y = Math.max(afterPatient, doc.y); doc.moveDown(0.6);

  const doctors = [...new Set(input.prescriptions.map((p) => p.doctorName))];
  if (doctors.length) label("Prescribed by", doctors.join(", "));
  doc.moveDown(0.4);

  // ℞ — from the font if it has the glyph, else "Rx"
  doc.font("B").fontSize(20);
  // `_font` is pdfkit's private field: if it ever changes shape, "Rx" it is.
  let hasRx = false;
  try {
    hasRx = (doc as unknown as { _font: { font: { hasGlyphForCodePoint(c: number): boolean } } })
      ._font.font.hasGlyphForCodePoint(0x211e);
  } catch { /* fall back to "Rx" */ }
  doc.fillColor(ACCENT).text(hasRx ? "℞" : "Rx", { width });
  doc.moveDown(0.3);

  // Medicines, verbatim
  const indent = 18;
  const bodyW = width - indent;
  input.prescriptions.forEach((p, i) => {
    const lines: string[] = [`Dosage: ${p.dosage}`];
    if (p.durationDays != null) lines.push(`Duration: ${p.durationDays} ${p.durationDays === 1 ? "day" : "days"}`);
    if (p.notes) lines.push(`Notes: ${p.notes}`);
    if (p.status !== "active") lines.push(`Status: ${p.status}`);
    doc.font("B").fontSize(11);
    let h = doc.heightOfString(p.drugName, { width: bodyW });
    doc.font("R").fontSize(9.5);
    for (const l of lines) h += doc.heightOfString(l, { width: bodyW });
    // keep a medicine on one page unless it can't fit on any page
    const room = doc.page.height - doc.page.margins.bottom - doc.y;
    if (h > room && h < doc.page.height / 2) doc.addPage();

    const y = doc.y;
    doc.font("B").fontSize(11).fillColor(MUTED).text(`${i + 1}.`, left, y, { width: indent });
    doc.fillColor(INK).text(p.drugName, left + indent, y, { width: bodyW });
    doc.font("R").fontSize(9.5).fillColor(INK);
    for (const l of lines) doc.text(l, left + indent, doc.y, { width: bodyW });
    doc.x = left; doc.moveDown(0.7);
  });

  // Signature
  doc.font("R").fontSize(9);
  if (doc.page.height - doc.page.margins.bottom - doc.y < 60) doc.addPage();
  doc.y += 30;
  const sigW = 150;
  doc.moveTo(left + width - sigW, doc.y).lineTo(left + width, doc.y).lineWidth(0.5).strokeColor(MUTED).stroke();
  doc.moveDown(0.3);
  doc.fillColor(MUTED).text("Doctor's signature", left + width - sigW, doc.y, { width: sigW, align: "center" });

  // Footer on every page (bottom margin dropped so pdfkit doesn't break the page)
  const footer = "This is your record exactly as your doctor entered it. For any question about it, " +
    (input.clinicPhone ? `call the clinic on ${input.clinicPhone.replace(/ /g, " ")}.` : "call the clinic.");
  const range = doc.bufferedPageRange();
  for (let n = range.start; n < range.start + range.count; n++) {
    doc.switchToPage(n);
    doc.page.margins.bottom = 0;
    const fy = doc.page.height - 36 - FOOTER_H + 8;
    doc.moveTo(left, fy).lineTo(left + width, fy).lineWidth(0.5).strokeColor("#d0d5d8").stroke();
    doc.font("R").fontSize(7.5).fillColor(MUTED).text(footer, left, fy + 6, { width });
    doc.fontSize(7).text(`Generated from Doctor-CRM · Page ${n + 1} of ${range.count}`, left, doc.y + 2, { width });
  }

  doc.end();
  return done;
}

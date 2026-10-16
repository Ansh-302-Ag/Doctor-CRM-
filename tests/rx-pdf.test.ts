import test from "node:test";
import assert from "node:assert/strict";
import { renderPrescriptionPdf, type RxPdfInput } from "../src/lib/rx-pdf";

const med = (i: number) => ({
  drugName: `Amoxicillin ${i}`, dosage: "500mg twice daily", durationDays: 5, notes: "After food",
  doctorName: "Dr. Mehta", createdAt: new Date("2026-10-01T05:00:00Z"), status: "active",
});
const input = (n: number): RxPdfInput => ({
  clinicName: "Sunrise Clinic", clinicPhone: "+91 98765 43210",
  patientName: "दक्षिणा मित्तल", patientPhone: "+91 91234 56789",
  issuedAt: new Date("2026-10-01T20:00:00Z"), timezone: "Asia/Kolkata",
  prescriptions: Array.from({ length: n }, (_, i) => med(i + 1)),
});
const pages = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type \/Page(?!s)/g) ?? []).length;

test("renders a PDF with a Devanagari patient name and a Latin drug", async () => {
  const pdf = await renderPrescriptionPdf(input(1));
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.equal(pages(pdf), 1);
});

test("embeds IBM Plex Sans Devanagari and never Helvetica", async () => {
  const s = (await renderPrescriptionPdf(input(2))).toString("latin1");
  assert.match(s, /IBMPlexSansDevanagari/);
  assert.doesNotMatch(s, /Helvetica/);
});

test("25 medicines flow onto more than one page", async () => {
  assert.ok(pages(await renderPrescriptionPdf(input(25))) > 1);
});

test("no clinic phone and no patient name still render", async () => {
  const pdf = await renderPrescriptionPdf({ ...input(1), clinicPhone: null, patientName: null });
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
});

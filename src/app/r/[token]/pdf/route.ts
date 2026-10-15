/** The patient's prescription as a PDF — only for a browser that verified the
 *  one-time code for THIS link in the last few minutes; anything else is 404. */
import { sql } from "@/lib/db";
import { linkPreview, readRecord } from "@/lib/record-links";
import { viewedLinkId } from "@/lib/record-session";
import { renderPrescriptionPdf } from "@/lib/rx-pdf";

const notFound = () => new Response("Not found", {
  status: 404, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
});

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const preview = await linkPreview(sql, token);
  if (!preview || (await viewedLinkId()) !== preview.linkId) return notFound();
  const record = await readRecord(sql, preview.linkId, new Date(), "download_prescription_pdf");
  if (!record || record.prescriptions.length === 0) return notFound();

  const issuedAt = new Date();
  const pdf = await renderPrescriptionPdf({
    clinicName: record.clinicName, clinicPhone: record.clinicPhone,
    patientName: record.patientName, patientPhone: record.patientPhone,
    issuedAt, timezone: record.timezone, prescriptions: record.prescriptions,
  });
  // No patient name in the file name: downloads folders get synced and shared.
  const slug = record.clinicName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "clinic";
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: record.timezone }).format(issuedAt);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="prescription-${slug}-${day}.pdf"`,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
    },
  });
}

import PDFDocument from "pdfkit";

/**
 * Generator PDF invoice — pdfkit sisi server mengikuti pola
 * quotation-pdf.ts. Nominal invoice berasal dari termin quotation
 * (sudah termasuk PPN bila quotation ber-PPN), maka breakdown DPP/PPN
 * di sini DITURUNKAN dari nominal: DPP = nominal / (1 + persen/100).
 */

const COLOR_TEXT = "#111827";
const COLOR_MUTED = "#6b7280";
const COLOR_LINE = "#d1d5db";
const COLOR_ACCENT = "#1d1dcc";

type Doc = InstanceType<typeof PDFDocument>;

export interface InvoicePdfData {
  invoice_number: string;
  label: string;
  amount: number;
  paid: number;
  due_date: string | null;
  status: string;
  created_at: string;
  company_name: string | null;
  branch_name: string | null;
  org_name: string;
  pic_name: string;
  pic_title: string | null;
  deal_title: string;
  event_type_label: string;
  event_date: string | null;
  quote_number: string | null;
  term_percent: number | null;
  use_ppn: boolean;
  ppn_persen: number;
  note: string | null;
  owner_name: string | null;
}

function rupiah(value: number): string {
  return "Rp " + Math.round(value || 0).toLocaleString("id-ID");
}

function tanggal(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function hLine(doc: Doc): void {
  doc
    .strokeColor(COLOR_LINE)
    .lineWidth(0.7)
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .stroke();
}

export function invoiceFileName(invoiceNumber: string, orgName: string): string {
  const safeOrg = orgName.replace(/[^a-zA-Z0-9 -]/g, "").trim().replace(/\s+/g, "-");
  return `${invoiceNumber}-${safeOrg || "invoice"}.pdf`;
}

export async function buildInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 48, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const width = right - left;

  // ── Kop ──
  doc.font("Helvetica-Bold").fontSize(14).fillColor(COLOR_TEXT);
  doc.text(data.company_name?.trim() || "INVOICE", { align: "center" });
  if (data.branch_name) {
    doc.font("Helvetica").fontSize(9).fillColor(COLOR_MUTED);
    doc.text(data.branch_name, { align: "center" });
  }
  doc.moveDown(0.5);
  doc.font("Helvetica-Bold").fontSize(12).fillColor(COLOR_ACCENT);
  doc.text(`INVOICE ${data.invoice_number}`, { align: "center" });
  doc.moveDown(0.5);
  hLine(doc);
  doc.moveDown(0.6);

  // ── Info dua kolom ──
  const infoTop = doc.y;
  const half = width / 2;
  const info = (label: string, value: string, x: number, y: number) => {
    doc.font("Helvetica").fontSize(8.5).fillColor(COLOR_MUTED);
    doc.text(label, x, y, { width: half - 10 });
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(COLOR_TEXT);
    doc.text(value || "—", x, y + 11, { width: half - 10 });
  };
  info(
    "Ditagihkan kepada",
    `${data.org_name} — up. ${data.pic_name}${data.pic_title ? ` (${data.pic_title})` : ""}`,
    left,
    infoTop
  );
  info("Tanggal Invoice", tanggal(data.created_at), left + half, infoTop);
  info("Acara", `${data.deal_title} (${data.event_type_label})`, left, infoTop + 30);
  info(
    "Tanggal Acara / Jatuh Tempo",
    `${tanggal(data.event_date)} / ${tanggal(data.due_date)}`,
    left + half,
    infoTop + 30
  );
  doc.y = infoTop + 62;
  hLine(doc);
  doc.moveDown(0.5);

  // ── Rincian tagihan ──
  const colAmount = left + width * 0.7;
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(COLOR_MUTED);
  const headY = doc.y;
  doc.text("KETERANGAN", left, headY, { width: colAmount - left - 8 });
  doc.text("JUMLAH", colAmount, headY, { width: right - colAmount, align: "right" });
  doc.moveDown(0.4);
  hLine(doc);
  doc.moveDown(0.35);

  const rowY = doc.y;
  doc.font("Helvetica").fontSize(9.5).fillColor(COLOR_TEXT);
  const description =
    data.label +
    (data.term_percent !== null
      ? ` (${Number(data.term_percent).toLocaleString("id-ID")}% dari nilai kesepakatan)`
      : "") +
    (data.quote_number ? ` — sesuai ${data.quote_number}` : "");
  const descHeight = doc.heightOfString(description, {
    width: colAmount - left - 8,
  });
  doc.text(description, left, rowY, { width: colAmount - left - 8 });
  doc.font("Helvetica-Bold");
  doc.text(rupiah(data.amount), colAmount, rowY, {
    width: right - colAmount,
    align: "right",
  });
  doc.y = rowY + Math.max(descHeight, 12) + 8;
  hLine(doc);
  doc.moveDown(0.4);

  // ── Total + breakdown PPN (mengikuti setelan quotation) ──
  const totalRow = (label: string, value: string, bold = false) => {
    const y = doc.y;
    doc
      .font(bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(bold ? 11 : 9.5)
      .fillColor(bold ? COLOR_TEXT : COLOR_MUTED);
    doc.text(label, left, y, { width: colAmount - left - 8, align: "right" });
    doc.fillColor(COLOR_TEXT);
    doc.text(value, colAmount, y, { width: right - colAmount, align: "right" });
    doc.moveDown(0.25);
  };

  if (data.use_ppn && data.ppn_persen > 0) {
    // Nominal termin sudah termasuk PPN — pecah DPP & PPN dari nominal
    const dpp = Math.round(data.amount / (1 + data.ppn_persen / 100));
    totalRow("DPP", rupiah(dpp));
    totalRow(`PPN ${data.ppn_persen}%`, rupiah(data.amount - dpp));
  }
  totalRow("TOTAL TAGIHAN", rupiah(data.amount), true);
  if (data.paid > 0) {
    totalRow("Sudah dibayar", rupiah(data.paid));
    totalRow("SISA TAGIHAN", rupiah(Math.max(0, data.amount - data.paid)), true);
  }

  // ── Catatan ──
  if (data.note) {
    doc.moveDown(0.8);
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(COLOR_MUTED);
    doc.text("CATATAN", left, doc.y);
    doc.moveDown(0.2);
    doc.font("Helvetica").fontSize(9).fillColor(COLOR_TEXT);
    doc.text(data.note, left, doc.y, { width });
  }

  // ── Tanda tangan ──
  doc.moveDown(2);
  doc.font("Helvetica").fontSize(9.5).fillColor(COLOR_TEXT);
  doc.text("Hormat kami,", left, doc.y);
  doc.moveDown(3);
  doc.font("Helvetica-Bold");
  doc.text(data.owner_name ?? data.branch_name ?? "Tim Sales", left, doc.y);
  doc.font("Helvetica").fontSize(8).fillColor(COLOR_MUTED);
  doc.moveDown(1.2);
  doc.text(
    "Dokumen ini dibuat otomatis oleh sistem dan sah tanpa tanda tangan basah.",
    left,
    doc.y,
    { width }
  );

  doc.end();
  return finished;
}

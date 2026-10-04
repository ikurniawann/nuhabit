import PDFDocument from "pdfkit";
import { formatNumber, formatRupiah } from "@/lib/format";

/**
 * Generator PDF quotation (EPIC-022 Fase F2) — pdfkit sisi server mengikuti
 * pola payslip-pdf.ts: dokumen penawaran resmi harus identik di perangkat
 * mana pun, bukan hasil window.print() yang bergantung browser.
 */

const COLOR_TEXT = "#111827";
const COLOR_MUTED = "#6b7280";
const COLOR_LINE = "#d1d5db";
const COLOR_ACCENT = "#00281a";

type Doc = InstanceType<typeof PDFDocument>;

export interface QuotationPdfItem {
  description: string;
  item_type: string;
  qty: number;
  unit_price: number;
  line_total: number;
}

/** Termin pembayaran (Fase G) — nominal sudah dialokasikan dari persen. */
export interface QuotationPdfTerm {
  label: string;
  percent: number;
  amount: number;
  due_date: string | null;
}

export interface QuotationPdfData {
  quote_number: string;
  created_at: string;
  valid_until: string | null;
  status: string;
  company_name: string | null;
  branch_name: string | null;
  org_name: string;
  pic_name: string;
  pic_title: string | null;
  deal_title: string;
  event_type_label: string;
  event_date: string | null;
  use_ppn: boolean;
  ppn_persen: number;
  subtotal: number;
  discount_percent?: number;
  discount_nominal?: number;
  ppn_nominal: number;
  total: number;
  notes: string | null;
  owner_name: string | null;
  items: QuotationPdfItem[];
  terms?: QuotationPdfTerm[];
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

export function quotationFileName(quoteNumber: string, orgName: string): string {
  const safeOrg = orgName.replace(/[^a-zA-Z0-9 -]/g, "").trim().replace(/\s+/g, "-");
  return `${quoteNumber}-${safeOrg || "quotation"}.pdf`;
}

export async function buildQuotationPdf(data: QuotationPdfData): Promise<Buffer> {
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
  doc.text(data.company_name?.trim() || "PENAWARAN HARGA", { align: "center" });
  if (data.branch_name) {
    doc.font("Helvetica").fontSize(9).fillColor(COLOR_MUTED);
    doc.text(data.branch_name, { align: "center" });
  }
  doc.moveDown(0.5);
  doc.font("Helvetica-Bold").fontSize(12).fillColor(COLOR_ACCENT);
  doc.text(`QUOTATION ${data.quote_number}`, { align: "center" });
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
  info("Kepada", `${data.org_name} — up. ${data.pic_name}${data.pic_title ? ` (${data.pic_title})` : ""}`, left, infoTop);
  info("Tanggal", tanggal(data.created_at), left + half, infoTop);
  info("Acara", `${data.deal_title} (${data.event_type_label})`, left, infoTop + 30);
  info(
    "Tanggal Acara / Berlaku s.d.",
    `${tanggal(data.event_date)} / ${tanggal(data.valid_until)}`,
    left + half,
    infoTop + 30
  );
  doc.y = infoTop + 62;
  hLine(doc);
  doc.moveDown(0.5);

  // ── Tabel item ──
  const colDesc = left;
  const colQty = left + width * 0.52;
  const colPrice = left + width * 0.64;
  const colTotal = left + width * 0.84;

  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(COLOR_MUTED);
  const headY = doc.y;
  doc.text("DESKRIPSI", colDesc, headY, { width: colQty - colDesc - 8 });
  doc.text("QTY", colQty, headY, { width: colPrice - colQty - 8, align: "right" });
  doc.text("HARGA", colPrice, headY, { width: colTotal - colPrice - 8, align: "right" });
  doc.text("JUMLAH", colTotal, headY, { width: right - colTotal, align: "right" });
  doc.moveDown(0.4);
  hLine(doc);
  doc.moveDown(0.35);

  const pageBottom = () => doc.page.height - doc.page.margins.bottom;

  for (const item of data.items) {
    // Ukur tinggi baris DULU lalu pindah halaman manual bila tidak muat —
    // page-break implisit pdfkit di tengah baris membuat kolom qty/harga
    // tercecer di halaman lama sementara deskripsi lompat ke halaman baru
    // (temuan HIGH gate F2).
    doc.font("Helvetica").fontSize(9.5);
    const descHeight = doc.heightOfString(item.description, {
      width: colQty - colDesc - 8,
    });
    const rowHeight = Math.max(descHeight, 12);
    if (doc.y + rowHeight + 10 > pageBottom()) {
      doc.addPage();
    }

    const rowY = doc.y;
    doc.fillColor(COLOR_TEXT);
    doc.text(item.description, colDesc, rowY, {
      width: colQty - colDesc - 8,
      // paksa tanpa auto-break: tinggi sudah dipastikan muat di atas
      lineBreak: true,
    });
    doc.text(
      `${formatNumber(item.qty, 3)}${item.item_type === "produk" ? " pax" : ""}`,
      colQty,
      rowY,
      { width: colPrice - colQty - 8, align: "right" }
    );
    doc.text(formatRupiah(item.unit_price), colPrice, rowY, {
      width: colTotal - colPrice - 8,
      align: "right",
    });
    doc.font("Helvetica-Bold");
    doc.text(formatRupiah(item.line_total), colTotal, rowY, {
      width: right - colTotal,
      align: "right",
    });
    doc.y = rowY + rowHeight + 6;
  }

  // Blok total + catatan + ttd butuh ruang — pindah halaman bila mepet
  if (doc.y + 170 > pageBottom()) {
    doc.addPage();
  }

  hLine(doc);
  doc.moveDown(0.4);

  // ── Total ──
  const totalRow = (label: string, value: string, bold = false) => {
    const y = doc.y;
    doc
      .font(bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(bold ? 11 : 9.5)
      .fillColor(bold ? COLOR_TEXT : COLOR_MUTED);
    doc.text(label, colPrice - 60, y, { width: colTotal - colPrice + 52, align: "right" });
    doc.fillColor(COLOR_TEXT);
    doc.text(value, colTotal, y, { width: right - colTotal, align: "right" });
    doc.moveDown(0.25);
  };
  totalRow("Subtotal", formatRupiah(data.subtotal));
  if (data.discount_nominal && Number(data.discount_nominal) > 0) {
    totalRow(`Diskon ${formatNumber(data.discount_percent, 3)}%`, `- ${formatRupiah(Number(data.discount_nominal))}`);
  }
  if (data.use_ppn) {
    totalRow(`PPN ${data.ppn_persen}%`, formatRupiah(data.ppn_nominal));
  }
  totalRow("TOTAL", formatRupiah(data.total), true);

  // ── Termin pembayaran (Fase G) ──
  if (data.terms && data.terms.length > 0) {
    doc.moveDown(0.8);
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(COLOR_MUTED);
    doc.text("TERMIN PEMBAYARAN", left, doc.y);
    doc.moveDown(0.3);
    for (const term of data.terms) {
      if (doc.y + 16 > pageBottom()) doc.addPage();
      const y = doc.y;
      doc.font("Helvetica").fontSize(9).fillColor(COLOR_TEXT);
      doc.text(
        `${term.label} (${formatNumber(term.percent, 3)}%)` +
          (term.due_date ? ` — jatuh tempo ${tanggal(term.due_date)}` : ""),
        left,
        y,
        { width: colTotal - left - 8 }
      );
      doc.font("Helvetica-Bold");
      doc.text(formatRupiah(term.amount), colTotal, y, {
        width: right - colTotal,
        align: "right",
      });
      doc.moveDown(0.25);
    }
  }

  // ── Catatan ──
  if (data.notes) {
    doc.moveDown(0.8);
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(COLOR_MUTED);
    doc.text("CATATAN", left, doc.y);
    doc.moveDown(0.2);
    doc.font("Helvetica").fontSize(9).fillColor(COLOR_TEXT);
    doc.text(data.notes, left, doc.y, { width });
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

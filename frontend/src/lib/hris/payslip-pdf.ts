import PDFDocument from "pdfkit";
import { loanInstallmentLabel, type LoanInstallmentDetail } from "@/lib/payroll/loans";
import { formatShareOfGross } from "@/lib/payroll/share";

/**
 * Generator PDF slip gaji karyawan (EPIC-008 lanjutan).
 *
 * Mengikuti pola `contract-pdf.ts`: pdfkit di sisi server, bukan cetak dari
 * browser. Alasannya slip gaji adalah dokumen resmi — hasilnya harus sama di
 * perangkat mana pun, sedangkan hasil `window.print()` bergantung pada
 * browser, ukuran kertas, dan pengaturan margin masing-masing karyawan.
 *
 * Angka diambil apa adanya dari `payroll_details` — snapshot saat payroll
 * dihitung — sehingga slip yang diunduh ulang tahun depan tetap sama.
 */

const COLOR_TEXT = "#111827";
const COLOR_MUTED = "#6b7280";
const COLOR_LINE = "#d1d5db";
const COLOR_NEGATIVE = "#b91c1c";

const MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

type Doc = InstanceType<typeof PDFDocument>;

export interface PayslipCompanyInfo {
  legal_name: string | null;
  address: string | null;
  city: string | null;
}

export interface PayslipEmployeeInfo {
  full_name: string;
  nip: string | null;
  position_title: string | null;
  department_name: string | null;
}

export interface PayslipAmounts {
  base_salary: number;
  fixed_allowance: number;
  variable_allowance: number;
  transport_allowance: number;
  meal_allowance: number;
  housing_allowance: number;
  overtime_pay: number;
  thr: number;
  bonus: number;
  other_earning: number;
  gross_salary: number;
  bpjs_tk_jht_deduction: number;
  bpjs_tk_jp_deduction: number;
  bpjs_kes_deduction: number;
  tapera_deduction: number;
  pph21_deduction: number;
  unpaid_leave_deduction: number;
  late_deduction: number;
  loan_deduction: number;
  other_deduction: number;
  total_deductions: number;
  net_salary: number;
  working_days: number;
  present_days: number;
  overtime_hours: number;
  loan_details: LoanInstallmentDetail[];
}

export interface PayslipPeriod {
  month: number;
  year: number;
  paid_at: string | null;
  status: string;
}

export interface PayslipDocumentData {
  company: PayslipCompanyInfo;
  employee: PayslipEmployeeInfo;
  period: PayslipPeriod;
  amounts: PayslipAmounts;
}

function rupiah(value: number): string {
  return "Rp " + Math.round(value || 0).toLocaleString("id-ID");
}

function periodLabel(period: PayslipPeriod): string {
  return `${MONTHS[period.month - 1] ?? period.month} ${period.year}`;
}

/** Nama berkas aman: tanpa spasi/karakter yang menyulitkan di berbagai OS. */
export function payslipFileName(
  employeeName: string,
  period: PayslipPeriod
): string {
  const nama = employeeName
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  return `Slip-Gaji-${nama || "Karyawan"}-${MONTHS[period.month - 1] ?? period.month}-${period.year}.pdf`;
}

function hLine(doc: Doc, y?: number) {
  const top = y ?? doc.y;
  doc
    .strokeColor(COLOR_LINE)
    .lineWidth(0.7)
    .moveTo(doc.page.margins.left, top)
    .lineTo(doc.page.width - doc.page.margins.right, top)
    .stroke();
}

/** Baris "label ..... nominal" dengan nominal rata kanan. */
function amountRow(
  doc: Doc,
  label: string,
  amount: number,
  options: { bold?: boolean; negative?: boolean; indent?: number; share?: string | null } = {}
) {
  const left = doc.page.margins.left + (options.indent ?? 0);
  const right = doc.page.width - doc.page.margins.right;
  const y = doc.y;

  doc
    .font(options.bold ? "Helvetica-Bold" : "Helvetica")
    .fontSize(9.5)
    .fillColor(options.negative ? COLOR_NEGATIVE : COLOR_TEXT);

  doc.text(label, left, y, { width: right - left - 180 });

  // Kolom porsi terhadap bruto; dibiarkan kosong bila tidak bermakna.
  if (options.share) {
    doc.font("Helvetica").fontSize(8.5).fillColor(COLOR_MUTED);
    doc.text(options.share, right - 180, y + 0.8, { width: 56, align: "right" });
    doc
      .font(options.bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(9.5)
      .fillColor(options.negative ? COLOR_NEGATIVE : COLOR_TEXT);
  }

  doc.text((options.negative ? "-" : "") + rupiah(amount), right - 120, y, {
    width: 120,
    align: "right",
  });
  doc.y = y + 14;
}

function sectionTitle(doc: Doc, title: string) {
  doc.moveDown(0.4);
  doc.font("Helvetica-Bold").fontSize(10).fillColor(COLOR_TEXT);
  doc.text(title.toUpperCase());
  doc.moveDown(0.15);
  hLine(doc);
  doc.moveDown(0.3);
}

function infoRow(doc: Doc, label: string, value: string, x: number, y: number, width: number) {
  doc.font("Helvetica").fontSize(8.5).fillColor(COLOR_MUTED);
  doc.text(label, x, y, { width });
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor(COLOR_TEXT);
  doc.text(value || "—", x, y + 11, { width });
}

export async function buildPayslipPdf(data: PayslipDocumentData): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 48, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const { company, employee, period, amounts } = data;
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const half = (right - left) / 2;

  // ── Kop ────────────────────────────────────────────────────────────────
  doc.font("Helvetica-Bold").fontSize(13).fillColor(COLOR_TEXT);
  doc.text(company.legal_name?.trim() || "SLIP GAJI", { align: "center" });
  if (company.address || company.city) {
    doc.font("Helvetica").fontSize(8.5).fillColor(COLOR_MUTED);
    doc.text([company.address, company.city].filter(Boolean).join(", "), { align: "center" });
  }
  doc.moveDown(0.5);
  doc.font("Helvetica-Bold").fontSize(11).fillColor(COLOR_TEXT);
  doc.text(`SLIP GAJI — ${periodLabel(period).toUpperCase()}`, { align: "center" });
  doc.moveDown(0.5);
  hLine(doc);
  doc.moveDown(0.6);

  // ── Identitas karyawan ─────────────────────────────────────────────────
  const infoTop = doc.y;
  infoRow(doc, "Nama Karyawan", employee.full_name, left, infoTop, half - 10);
  infoRow(doc, "NIP", employee.nip ?? "—", left + half, infoTop, half - 10);
  infoRow(doc, "Jabatan", employee.position_title ?? "—", left, infoTop + 30, half - 10);
  infoRow(doc, "Departemen", employee.department_name ?? "—", left + half, infoTop + 30, half - 10);
  doc.y = infoTop + 62;

  const kehadiran = `${amounts.present_days} dari ${amounts.working_days} hari kerja`;
  infoRow(doc, "Kehadiran", kehadiran, left, doc.y, half - 10);
  infoRow(
    doc,
    "Jam Lembur",
    amounts.overtime_hours ? `${amounts.overtime_hours} jam` : "—",
    left + half,
    doc.y,
    half - 10
  );
  doc.y += 32;

  // ── Penghasilan ────────────────────────────────────────────────────────
  sectionTitle(doc, "Penghasilan");
  amountRow(doc, "Gaji Pokok", amounts.base_salary);
  if (amounts.fixed_allowance) amountRow(doc, "Tunjangan Tetap", amounts.fixed_allowance);
  if (amounts.variable_allowance) amountRow(doc, "Tunjangan Variabel", amounts.variable_allowance);
  if (amounts.transport_allowance) amountRow(doc, "Tunjangan Transport", amounts.transport_allowance);
  if (amounts.meal_allowance) amountRow(doc, "Tunjangan Makan", amounts.meal_allowance);
  if (amounts.housing_allowance) amountRow(doc, "Tunjangan Perumahan", amounts.housing_allowance);
  if (amounts.overtime_pay) amountRow(doc, "Lembur", amounts.overtime_pay);
  if (amounts.thr) amountRow(doc, "THR", amounts.thr);
  if (amounts.bonus) amountRow(doc, "Bonus", amounts.bonus);
  if (amounts.other_earning) amountRow(doc, "Penghasilan Lain", amounts.other_earning);
  hLine(doc);
  doc.moveDown(0.25);
  amountRow(doc, "Total Penghasilan Bruto", amounts.gross_salary, { bold: true });

  // ── Potongan ───────────────────────────────────────────────────────────
  sectionTitle(doc, "Potongan");
  // Penanda kolom agar angka persen tidak menggantung tanpa keterangan.
  {
    const y = doc.y;
    doc.font("Helvetica").fontSize(7.5).fillColor(COLOR_MUTED);
    doc.text("% dari bruto", right - 180, y, { width: 56, align: "right" });
    doc.y = y + 11;
  }
  const share = (amount: number) => formatShareOfGross(amount, amounts.gross_salary);
  if (amounts.bpjs_tk_jht_deduction) amountRow(doc, "BPJS TK (JHT)", amounts.bpjs_tk_jht_deduction, { negative: true, share: share(amounts.bpjs_tk_jht_deduction) });
  if (amounts.bpjs_tk_jp_deduction) amountRow(doc, "BPJS TK (JP)", amounts.bpjs_tk_jp_deduction, { negative: true, share: share(amounts.bpjs_tk_jp_deduction) });
  if (amounts.bpjs_kes_deduction) amountRow(doc, "BPJS Kesehatan", amounts.bpjs_kes_deduction, { negative: true, share: share(amounts.bpjs_kes_deduction) });
  if (amounts.tapera_deduction) amountRow(doc, "Tapera", amounts.tapera_deduction, { negative: true, share: share(amounts.tapera_deduction) });
  if (amounts.pph21_deduction) amountRow(doc, "PPh 21", amounts.pph21_deduction, { negative: true, share: share(amounts.pph21_deduction) });
  if (amounts.unpaid_leave_deduction)
    amountRow(doc, "Cuti Tanpa Bayaran", amounts.unpaid_leave_deduction, { negative: true, share: share(amounts.unpaid_leave_deduction) });
  if (amounts.late_deduction)
    amountRow(doc, "Potongan Keterlambatan", amounts.late_deduction, { negative: true, share: share(amounts.late_deduction) });

  // Rincian cicilan per pinjaman bila snapshot-nya ada; data lama yang belum
  // punya rincian tetap tampil sebagai satu baris agregat.
  if (amounts.loan_details.length > 0) {
    for (const loan of amounts.loan_details) {
      amountRow(doc, loanInstallmentLabel(loan), loan.amount, { negative: true, share: share(loan.amount) });
    }
  } else if (amounts.loan_deduction) {
    amountRow(doc, "Cicilan Pinjaman", amounts.loan_deduction, { negative: true, share: share(amounts.loan_deduction) });
  }

  if (amounts.other_deduction) amountRow(doc, "Potongan Lain", amounts.other_deduction, { negative: true, share: share(amounts.other_deduction) });
  hLine(doc);
  doc.moveDown(0.25);
  amountRow(doc, "Total Potongan", amounts.total_deductions, {
    bold: true,
    negative: true,
    share: share(amounts.total_deductions),
  });

  // ── Gaji bersih ────────────────────────────────────────────────────────
  doc.moveDown(0.5);
  const boxTop = doc.y;
  doc.roundedRect(left, boxTop, right - left, 34, 5).fillAndStroke("#f3f4f6", COLOR_LINE);
  doc.fillColor(COLOR_TEXT).font("Helvetica-Bold").fontSize(11);
  doc.text("GAJI BERSIH (TAKE HOME PAY)", left + 12, boxTop + 11, { width: right - left - 140 });
  doc.fontSize(13);
  doc.text(rupiah(amounts.net_salary), right - 140, boxTop + 9, { width: 128, align: "right" });
  doc.y = boxTop + 46;

  // ── Catatan kaki ───────────────────────────────────────────────────────
  doc.font("Helvetica").fontSize(7.5).fillColor(COLOR_MUTED);
  const dibayar = period.paid_at
    ? `Dibayarkan pada ${new Date(period.paid_at).toLocaleDateString("id-ID", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })}.`
    : "Status pembayaran belum final.";
  doc.text(
    `${dibayar} Dokumen ini dibuat otomatis oleh sistem dan sah tanpa tanda tangan basah. ` +
      "Bila ada nominal yang tidak sesuai, hubungi HRD.",
    { align: "left" }
  );

  doc.end();
  return finished;
}

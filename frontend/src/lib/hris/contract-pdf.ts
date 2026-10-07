import PDFDocument from "pdfkit";
import { terbilangRupiah } from "./terbilang";
import type { ContractType } from "./contracts";

/**
 * Generator PDF surat perjanjian kerja (PKWT / PKWTT) berbahasa Indonesia.
 * Template standar memuat klausul minimum Pasal 54 UU 13/2003; nilai yang
 * belum terisi dirender sebagai garis kosong agar tetap bisa dilengkapi
 * manual. Template ini bukan nasihat hukum — final direview legal perusahaan.
 */

export interface ContractCompanyInfo {
  legal_name: string | null;
  address: string | null;
  city: string | null;
  signer_name: string | null;
  signer_title: string | null;
}

export interface ContractEmployeeInfo {
  full_name: string;
  ktp: string | null;
  address: string | null;
  birth_date: string | null;
  phone: string | null;
}

export interface ContractInfo {
  contract_number: string;
  contract_type: ContractType;
  start_date: string;
  end_date: string | null;
  probation_end_date: string | null;
  position_title: string | null;
  department_name: string | null;
  work_location: string | null;
  base_salary: number | null;
  signed_at: string | null;
}

export interface ContractDocumentData {
  company: ContractCompanyInfo;
  employee: ContractEmployeeInfo;
  contract: ContractInfo;
}

const BLANK = "____________________";
const COLOR_TEXT = "#111827";

type Doc = InstanceType<typeof PDFDocument>;

function val(value: string | null | undefined): string {
  return value?.trim() ? value : BLANK;
}

function formatDateId(value: string | null): string {
  if (!value) return BLANK;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return BLANK;
  return date.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });
}

function formatIdr(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value <= 0) return BLANK;
  return `Rp ${new Intl.NumberFormat("id-ID").format(value)},- (${terbilangRupiah(value)})`;
}

function pasal(doc: Doc, nomor: number, judul: string) {
  doc.moveDown(0.9);
  doc.font("Helvetica-Bold").fontSize(10.5);
  doc.text(`PASAL ${nomor}`, { align: "center" });
  doc.text(judul.toUpperCase(), { align: "center" });
  doc.moveDown(0.35);
  doc.font("Helvetica").fontSize(10);
}

function para(doc: Doc, text: string) {
  doc.font("Helvetica").fontSize(10).fillColor(COLOR_TEXT);
  doc.text(text, { align: "justify", lineGap: 2.5 });
  doc.moveDown(0.3);
}

function numbered(doc: Doc, items: string[]) {
  items.forEach((item, index) => {
    doc.font("Helvetica").fontSize(10);
    doc.text(`${index + 1}. ${item}`, { align: "justify", lineGap: 2.5, indent: 0 });
    doc.moveDown(0.2);
  });
  doc.moveDown(0.1);
}

function partyRow(doc: Doc, label: string, value: string) {
  const x = doc.page.margins.left + 16;
  const labelWidth = 130;
  const y = doc.y;
  doc.font("Helvetica").fontSize(10);
  doc.text(label, x, y, { width: labelWidth });
  doc.text(
    `: ${value}`,
    x + labelWidth,
    y,
    { width: doc.page.width - doc.page.margins.right - x - labelWidth }
  );
  doc.x = doc.page.margins.left;
  doc.moveDown(0.15);
}

/** Nama file unduhan: "kontrak-0001-pkwt-vii-2026-budi-santoso.pdf". */
export function contractFileName(contractNumber: string, employeeName: string): string {
  const slug = `${contractNumber} ${employeeName}`
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `kontrak-${slug || "karyawan"}.pdf`;
}

export async function buildContractPdf(data: ContractDocumentData): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 56, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const { company, employee, contract } = data;
  const isPkwt = contract.contract_type === "pkwt";
  const judul = isPkwt
    ? "PERJANJIAN KERJA WAKTU TERTENTU (PKWT)"
    : "PERJANJIAN KERJA WAKTU TIDAK TERTENTU (PKWTT)";
  const tanggalTtd = formatDateId(contract.signed_at ?? contract.start_date);

  // ── Judul & nomor ──────────────────────────────────────────────────────
  doc.fillColor(COLOR_TEXT).font("Helvetica-Bold").fontSize(13);
  doc.text(judul, { align: "center" });
  doc.moveDown(0.2);
  doc.font("Helvetica").fontSize(10.5);
  doc.text(`Nomor: ${contract.contract_number}`, { align: "center" });
  doc.moveDown(1);

  // ── Pembukaan & para pihak ─────────────────────────────────────────────
  para(
    doc,
    `Pada hari ini, tanggal ${tanggalTtd}, bertempat di ${val(company.city)}, ` +
      "telah dibuat dan ditandatangani perjanjian kerja oleh dan antara:"
  );
  doc.moveDown(0.2);

  partyRow(doc, "Nama", val(company.signer_name));
  partyRow(doc, "Jabatan", val(company.signer_title));
  partyRow(doc, "Bertindak atas nama", val(company.legal_name));
  partyRow(doc, "Alamat", val(company.address));
  para(doc, 'Selanjutnya disebut sebagai "PIHAK PERTAMA" (Pengusaha).');
  doc.moveDown(0.3);

  partyRow(doc, "Nama", employee.full_name);
  partyRow(doc, "NIK (KTP)", val(employee.ktp));
  partyRow(doc, "Tanggal lahir", formatDateId(employee.birth_date));
  partyRow(doc, "Alamat", val(employee.address));
  partyRow(doc, "No. telepon", val(employee.phone));
  para(doc, 'Selanjutnya disebut sebagai "PIHAK KEDUA" (Pekerja).');
  doc.moveDown(0.2);

  para(
    doc,
    "Kedua belah pihak sepakat mengikatkan diri dalam perjanjian kerja dengan " +
      "ketentuan sebagai berikut:"
  );

  // ── Pasal 1: Jabatan & penempatan ──────────────────────────────────────
  pasal(doc, 1, "Jenis Pekerjaan, Jabatan, dan Penempatan");
  numbered(doc, [
    `PIHAK PERTAMA mempekerjakan PIHAK KEDUA sebagai ${val(contract.position_title)}` +
      (contract.department_name ? ` pada departemen ${contract.department_name}.` : "."),
    `Tempat kerja PIHAK KEDUA adalah ${val(contract.work_location)}, dengan kemungkinan ` +
      "penugasan di lokasi lain sesuai kebutuhan operasional yang wajar.",
  ]);

  // ── Pasal 2: Jangka waktu ──────────────────────────────────────────────
  pasal(doc, 2, "Jangka Waktu Perjanjian");
  if (isPkwt) {
    numbered(doc, [
      `Perjanjian ini berlaku untuk waktu tertentu, terhitung sejak tanggal ${formatDateId(contract.start_date)} ` +
        `sampai dengan tanggal ${formatDateId(contract.end_date)}.`,
      "Perjanjian ini TIDAK mensyaratkan masa percobaan, sesuai ketentuan PKWT dalam " +
        "PP Nomor 35 Tahun 2021.",
      "Perpanjangan perjanjian hanya dapat dilakukan sepanjang jangka waktu keseluruhan " +
        "PKWT (termasuk perpanjangan) tidak melebihi 5 (lima) tahun.",
    ]);
  } else {
    const items = [
      `Perjanjian ini berlaku untuk waktu tidak tertentu, terhitung sejak tanggal ${formatDateId(contract.start_date)}.`,
    ];
    if (contract.probation_end_date) {
      items.push(
        `PIHAK KEDUA menjalani masa percobaan sampai dengan tanggal ${formatDateId(contract.probation_end_date)} ` +
          "(maksimal 3 bulan sesuai Pasal 60 UU Nomor 13 Tahun 2003). Selama masa percobaan, " +
          "upah dibayarkan penuh dan masing-masing pihak dapat mengakhiri hubungan kerja."
      );
    }
    numbered(doc, items);
  }

  // ── Pasal 3: Upah ──────────────────────────────────────────────────────
  pasal(doc, 3, "Upah dan Cara Pembayaran");
  numbered(doc, [
    `PIHAK PERTAMA membayar upah pokok kepada PIHAK KEDUA sebesar ${formatIdr(contract.base_salary)} per bulan.`,
    "Upah dibayarkan selambat-lambatnya pada akhir bulan berjalan melalui transfer ke " +
      "rekening bank milik PIHAK KEDUA.",
    "Pajak penghasilan (PPh 21) atas upah ditanggung dan/atau dipotong sesuai ketentuan " +
      "peraturan perpajakan yang berlaku.",
  ]);

  // ── Pasal 4: Waktu kerja ───────────────────────────────────────────────
  pasal(doc, 4, "Waktu Kerja dan Istirahat");
  numbered(doc, [
    "Waktu kerja adalah 7 (tujuh) jam sehari dan 40 (empat puluh) jam seminggu untuk 6 " +
      "hari kerja, atau 8 (delapan) jam sehari dan 40 (empat puluh) jam seminggu untuk 5 " +
      "hari kerja, sesuai pengaturan jadwal oleh PIHAK PERTAMA.",
    "Kerja lembur hanya dilakukan atas persetujuan kedua belah pihak dan diberikan upah " +
      "lembur sesuai ketentuan peraturan perundang-undangan.",
    "PIHAK KEDUA berhak atas istirahat mingguan, istirahat antar jam kerja, cuti tahunan, " +
      "dan hak istirahat lain sesuai peraturan perundang-undangan.",
  ]);

  // ── Pasal 5: Hak & kewajiban ───────────────────────────────────────────
  pasal(doc, 5, "Jaminan Sosial dan Hak-Hak Lainnya");
  numbered(doc, [
    "PIHAK PERTAMA mengikutsertakan PIHAK KEDUA dalam program BPJS Ketenagakerjaan dan " +
      "BPJS Kesehatan sesuai ketentuan yang berlaku.",
    "PIHAK KEDUA wajib menaati peraturan perusahaan, menjaga kerahasiaan data dan " +
      "informasi milik perusahaan, serta melaksanakan pekerjaan dengan penuh tanggung jawab.",
  ]);

  let nomorPasal = 6;

  // ── Pasal 6 (khusus PKWT): uang kompensasi ─────────────────────────────
  if (isPkwt) {
    pasal(doc, nomorPasal, "Uang Kompensasi");
    numbered(doc, [
      "Pada saat berakhirnya perjanjian ini, PIHAK PERTAMA membayar uang kompensasi " +
        "kepada PIHAK KEDUA sesuai Pasal 15-16 PP Nomor 35 Tahun 2021, yaitu sebesar " +
        "(masa kerja dalam bulan / 12) x 1 (satu) bulan upah, secara proporsional.",
      "Uang kompensasi juga dibayarkan secara proporsional apabila perjanjian diakhiri " +
        "lebih awal oleh salah satu pihak.",
    ]);
    nomorPasal += 1;
  }

  // ── Pengakhiran ────────────────────────────────────────────────────────
  pasal(doc, nomorPasal, "Berakhirnya Hubungan Kerja");
  numbered(
    doc,
    isPkwt
      ? [
          "Hubungan kerja berakhir demi hukum pada saat berakhirnya jangka waktu perjanjian.",
          "Pihak yang mengakhiri hubungan kerja sebelum berakhirnya jangka waktu wajib " +
            "memberitahukan secara tertulis paling lambat 14 (empat belas) hari sebelumnya.",
        ]
      : [
          "Pengakhiran hubungan kerja dilaksanakan sesuai ketentuan pemutusan hubungan " +
            "kerja dalam UU Nomor 13 Tahun 2003 jo. UU Cipta Kerja beserta peraturan pelaksananya, " +
            "termasuk hak atas pesangon, penghargaan masa kerja, dan penggantian hak.",
        ]
  );
  nomorPasal += 1;

  // ── Perselisihan ───────────────────────────────────────────────────────
  pasal(doc, nomorPasal, "Penyelesaian Perselisihan");
  numbered(doc, [
    "Perselisihan yang timbul dari perjanjian ini diselesaikan terlebih dahulu secara " +
      "musyawarah (bipartit).",
    "Apabila musyawarah tidak mencapai kesepakatan, penyelesaian dilakukan sesuai UU " +
      "Nomor 2 Tahun 2004 tentang Penyelesaian Perselisihan Hubungan Industrial.",
  ]);
  nomorPasal += 1;

  // ── Penutup ────────────────────────────────────────────────────────────
  pasal(doc, nomorPasal, "Penutup");
  para(
    doc,
    "Perjanjian ini dibuat dalam rangkap 2 (dua) bermeterai cukup, masing-masing " +
      "mempunyai kekuatan hukum yang sama, dan ditandatangani secara sadar tanpa paksaan " +
      "dari pihak manapun. Hal-hal yang belum diatur dalam perjanjian ini mengacu pada " +
      "peraturan perusahaan dan peraturan perundang-undangan yang berlaku."
  );

  // ── Blok tanda tangan ──────────────────────────────────────────────────
  const needed = 150;
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom) doc.addPage();
  doc.moveDown(1.2);
  doc.font("Helvetica").fontSize(10);
  doc.text(`${val(company.city)}, ${tanggalTtd}`, { align: "right" });
  doc.moveDown(0.8);

  const colWidth =
    (doc.page.width - doc.page.margins.left - doc.page.margins.right) / 2;
  const yStart = doc.y;
  doc.font("Helvetica-Bold");
  doc.text("PIHAK PERTAMA,", doc.page.margins.left, yStart, {
    width: colWidth,
    align: "center",
  });
  doc.text("PIHAK KEDUA,", doc.page.margins.left + colWidth, yStart, {
    width: colWidth,
    align: "center",
  });
  const ySign = yStart + 84;
  doc.font("Helvetica");
  doc.text(val(company.signer_name), doc.page.margins.left, ySign, {
    width: colWidth,
    align: "center",
    underline: true,
  });
  doc.text(employee.full_name, doc.page.margins.left + colWidth, ySign, {
    width: colWidth,
    align: "center",
    underline: true,
  });
  doc.fontSize(9).fillColor("#6b7280");
  doc.text(val(company.signer_title), doc.page.margins.left, ySign + 14, {
    width: colWidth,
    align: "center",
  });
  doc.text(val(contract.position_title), doc.page.margins.left + colWidth, ySign + 14, {
    width: colWidth,
    align: "center",
  });

  doc.end();
  return finished;
}

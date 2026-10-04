/**
 * Pemetaan teks hasil OCR nota/faktur vendor → field form pembayaran
 * (EPIC-018 Fase B). Murni heuristik teks — tanpa DB, tanpa jaringan —
 * supaya mudah diuji dan hasilnya SELALU bisa dikoreksi manual oleh user
 * (OCR bisa salah baca; nilai ini prefill, bukan kebenaran).
 */

export interface ReceiptFields {
  /** Nomor nota/faktur/referensi, mis. "INV/2026/0712". */
  nomor: string | null;
  /** Tanggal nota, dinormalkan ke YYYY-MM-DD. */
  tanggal: string | null;
  /** Total tagihan dalam rupiah utuh. */
  total: number | null;
}

const MONTHS: Record<string, number> = {
  jan: 1, januari: 1,
  feb: 2, februari: 2, pebruari: 2,
  mar: 3, maret: 3,
  apr: 4, april: 4,
  mei: 5, may: 5,
  jun: 6, juni: 6,
  jul: 7, juli: 7,
  agu: 8, agustus: 8, aug: 8,
  sep: 9, september: 9,
  okt: 10, oktober: 10, oct: 10,
  nov: 11, november: 11, nop: 11, nopember: 11,
  des: 12, desember: 12, dec: 12,
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function validDate(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * Angka rupiah dari potongan teks nota: "Rp 1.234.567", "1,234,567.00",
 * "1234567", "Rp1.234.567,50". Pemisah terakhir dengan ≤2 digit di belakang
 * = desimal; sisanya pemisah ribuan.
 */
export function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/rp/gi, "").replace(/[^\d.,]/g, "");
  if (!/\d/.test(cleaned)) return null;

  const lastDot = cleaned.lastIndexOf(".");
  const lastComma = cleaned.lastIndexOf(",");
  const sepIndex = Math.max(lastDot, lastComma);

  let normalized: string;
  if (sepIndex === -1) {
    normalized = cleaned;
  } else {
    const after = cleaned.length - sepIndex - 1;
    // ≤2 digit setelah pemisah terakhir = desimal; 3 digit = ribuan ("1.500").
    const integerPart = after > 0 && after <= 2 ? cleaned.slice(0, sepIndex) : cleaned;
    const decimalPart = after > 0 && after <= 2 ? cleaned.slice(sepIndex + 1) : "";
    normalized = integerPart.replace(/[.,]/g, "") + (decimalPart ? `.${decimalPart}` : "");
  }

  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
}

/** Tanggal dari teks bebas: 12/07/2026, 12-07-26, 2026-07-12, "12 Juli 2026". */
export function findDate(text: string): string | null {
  // dd sep mm sep yyyy (pemisah / - .)
  const dmy = text.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
  if (dmy) {
    const d = Number(dmy[1]);
    const m = Number(dmy[2]);
    let y = Number(dmy[3]);
    if (y < 100) y += 2000;
    // Nota Indonesia menulis dd/mm; bila mm > 12 kemungkinan format mm/dd.
    const parsed = validDate(y, m, d) ?? validDate(y, d, m);
    if (parsed) return parsed;
  }

  // yyyy-mm-dd
  const ymd = text.match(/\b(20\d{2})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\b/);
  if (ymd) {
    const parsed = validDate(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
    if (parsed) return parsed;
  }

  // dd NamaBulan yyyy (Indonesia/Inggris, boleh singkatan)
  const named = text.match(/\b(\d{1,2})\s+([a-zA-Z]{3,9})\.?\s+(\d{2,4})\b/);
  if (named) {
    const m = MONTHS[named[2].toLowerCase()];
    let y = Number(named[3]);
    if (y < 100) y += 2000;
    if (m) {
      const parsed = validDate(y, m, Number(named[1]));
      if (parsed) return parsed;
    }
  }

  return null;
}

/** Nomor nota dari baris berlabel (No/Nomor/Invoice/Faktur/Nota/Ref). */
export function findNumber(text: string): string | null {
  const pattern =
    /(?:no(?:mor)?|invoice|faktur|nota|struk|ref(?:erensi)?|inv)\s*[.:#]?\s*((?:[A-Z0-9][A-Z0-9\/\-.]*)?\d[A-Z0-9\/\-.]*)/gi;
  // Iterasi SEMUA kandidat — kandidat pertama bisa false positive (mis.
  // "Jl. Merdeka No. 12" di kop nota), jangan berhenti di situ.
  for (const match of text.matchAll(pattern)) {
    const value = match[1].replace(/[.:]+$/, "").trim();
    // Nomor murni tanggal (12/07/2026) bukan nomor nota.
    if (/^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}$/.test(value)) continue;
    if (value.length >= 3 && value.length <= 40) return value.toUpperCase();
  }
  return null;
}

// \b di depan penting: tanpa itu "Subtotal" ikut cocok sebagai "total".
const TOTAL_KEYWORDS =
  /\b(?:grand\s*total|total(?:\s*(?:tagihan|bayar|belanja|akhir|harga))?|jumlah(?:\s*(?:bayar|tagihan))?|tagihan)\b/i;

/**
 * Total tagihan: cari baris berkata-kunci total, ambil angka paling KANAN di
 * baris itu, lalu pilih nilai TERBESAR di antara baris-baris kandidat
 * (grand total ≥ subtotal; "total qty" tersaring karena angkanya kecil
 * hanya bila ada kandidat lain yang lebih besar — heuristik, bukan jaminan).
 */
export function findTotal(text: string): number | null {
  let best: number | null = null;
  for (const line of text.split(/\n+/)) {
    if (!TOTAL_KEYWORDS.test(line)) continue;
    const numbers = line.match(/(?:rp\s*)?\d[\d.,]*/gi);
    if (!numbers?.length) continue;
    const value = parseAmount(numbers[numbers.length - 1]);
    if (value !== null && (best === null || value > best)) best = value;
  }
  return best;
}

export function parseReceiptText(text: string): ReceiptFields {
  const source = text.trim();
  if (!source) return { nomor: null, tanggal: null, total: null };
  return {
    nomor: findNumber(source),
    tanggal: findDate(source),
    total: findTotal(source),
  };
}

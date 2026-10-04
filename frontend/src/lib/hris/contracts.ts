/**
 * Aturan kontrak kerja Indonesia — helper murni (tanpa DB) untuk modul
 * kontrak karyawan. Acuan: UU 13/2003 jo. UU Cipta Kerja + PP 35/2021.
 *
 * - PKWT (kontrak): wajib tertulis + tanggal berakhir, TANPA masa percobaan,
 *   total durasi termasuk perpanjangan maksimal 5 tahun, dan berhak uang
 *   kompensasi pro-rata ((masa kerja bulan / 12) × 1 bulan upah) di akhir.
 * - PKWTT (tetap): boleh masa percobaan maksimal 3 bulan.
 */

export const PKWT_MAX_TOTAL_MONTHS = 60;
export const PKWTT_MAX_PROBATION_MONTHS = 3;

export type ContractType = "pkwtt" | "pkwt";

export type ContractStatus = "draft" | "active" | "ended" | "terminated" | "converted";

export interface ContractDatesInput {
  contract_type: ContractType;
  start_date: string;
  end_date?: string | null;
  probation_end_date?: string | null;
}

export interface ContractPeriod {
  start_date: string;
  end_date: string | null;
}

function parseDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Masa kerja dalam bulan: bulan kalender penuh + sisa hari / 30 (2 desimal). */
export function monthsWorked(start: string | Date, end: string | Date): number {
  const startDate = parseDate(start);
  const endDate = parseDate(end);
  if (!startDate || !endDate || endDate <= startDate) return 0;

  let months =
    (endDate.getFullYear() - startDate.getFullYear()) * 12 +
    (endDate.getMonth() - startDate.getMonth());
  let days = endDate.getDate() - startDate.getDate();
  if (days < 0) {
    months -= 1;
    days += 30;
  }
  return Math.round((months + days / 30) * 100) / 100;
}

/**
 * Uang kompensasi PKWT (PP 35/2021 Pasal 16):
 * (masa kerja bulan / 12) × 1 bulan upah, pro-rata; masa kerja < 1 bulan
 * tidak berhak. Dibulatkan ke rupiah.
 */
export function computeKompensasi(
  monthlyWage: number,
  start: string | Date,
  end: string | Date
): number {
  if (!Number.isFinite(monthlyWage) || monthlyWage <= 0) return 0;
  const months = monthsWorked(start, end);
  if (months < 1) return 0;
  return Math.round((months / 12) * monthlyWage);
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

/** Validasi tanggal & aturan tipe kontrak. Mengembalikan daftar pesan error (kosong = valid). */
export function validateContractDates(input: ContractDatesInput): string[] {
  const errors: string[] = [];
  const start = parseDate(input.start_date);
  const end = parseDate(input.end_date ?? null);
  const probation = parseDate(input.probation_end_date ?? null);

  if (!start) {
    errors.push("Tanggal mulai kontrak tidak valid.");
    return errors;
  }

  if (input.end_date && !end) errors.push("Tanggal berakhir kontrak tidak valid.");
  if (end && end <= start) {
    errors.push("Tanggal berakhir harus setelah tanggal mulai.");
  }

  if (input.contract_type === "pkwt") {
    if (!end) errors.push("PKWT wajib memiliki tanggal berakhir (perjanjian waktu tertentu).");
    if (input.probation_end_date) {
      errors.push(
        "PKWT tidak boleh memiliki masa percobaan — batal demi hukum (PP 35/2021)."
      );
    }
  } else {
    if (probation) {
      if (probation <= start) {
        errors.push("Akhir masa percobaan harus setelah tanggal mulai.");
      } else if (probation > addMonths(start, PKWTT_MAX_PROBATION_MONTHS)) {
        errors.push("Masa percobaan PKWTT maksimal 3 bulan (UU 13/2003 Pasal 60).");
      }
    }
  }

  return errors;
}

/** Total durasi (bulan) seluruh rantai kontrak PKWT seorang karyawan. */
export function pkwtChainTotalMonths(periods: ContractPeriod[]): number {
  const total = periods.reduce((sum, period) => {
    if (!period.end_date) return sum;
    return sum + monthsWorked(period.start_date, period.end_date);
  }, 0);
  return Math.round(total * 100) / 100;
}

/** Batas total PKWT 5 tahun (60 bulan) termasuk perpanjangan. Null = lolos. */
export function validatePkwtTotal(existingMonths: number, newMonths: number): string | null {
  const total = existingMonths + newMonths;
  if (total <= PKWT_MAX_TOTAL_MONTHS) return null;
  return (
    `Total durasi PKWT karyawan ini akan menjadi ${Math.round(total)} bulan — ` +
    `melebihi batas 5 tahun (${PKWT_MAX_TOTAL_MONTHS} bulan) sesuai PP 35/2021. ` +
    "Pertimbangkan konversi ke PKWTT (karyawan tetap)."
  );
}

/** Tambah bulan pada tanggal ISO (YYYY-MM-DD); tanggal melampaui akhir bulan
 *  tujuan dijepit ke hari terakhir bulan itu (31 Jan + 1 bln = 28/29 Feb). */
export function addMonthsIso(dateIso: string, months: number): string {
  const [year, month, day] = dateIso.split("-").map(Number);
  const targetMonthIndex = month - 1 + months;
  const lastDay = new Date(Date.UTC(year, targetMonthIndex + 1, 0)).getUTCDate();
  const result = new Date(Date.UTC(year, targetMonthIndex, Math.min(day, lastDay)));
  return result.toISOString().slice(0, 10);
}

/** Durasi default draft PKWT hasil promote — disesuaikan HRD sebelum aktivasi. */
export const DEFAULT_PKWT_MONTHS = 12;

export interface DraftContractDates {
  contract_type: ContractType;
  start_date: string;
  end_date: string | null;
  probation_end_date: string | null;
}

/**
 * Pemetaan status kepegawaian (dipilih HRD saat promote kandidat → karyawan)
 * ke draft kontrak: contract → PKWT 12 bulan; probation → PKWTT + percobaan
 * 3 bulan; permanent → PKWTT. Selain itu (magang dsb.) → null, tidak
 * dibuatkan draft.
 */
export function draftContractFromEmploymentStatus(
  employmentStatus: string,
  joinDate: string
): DraftContractDates | null {
  switch (employmentStatus) {
    case "contract":
      return {
        contract_type: "pkwt",
        start_date: joinDate,
        end_date: addMonthsIso(joinDate, DEFAULT_PKWT_MONTHS),
        probation_end_date: null,
      };
    case "probation":
      return {
        contract_type: "pkwtt",
        start_date: joinDate,
        end_date: null,
        probation_end_date: addMonthsIso(joinDate, PKWTT_MAX_PROBATION_MONTHS),
      };
    case "permanent":
      return {
        contract_type: "pkwtt",
        start_date: joinDate,
        end_date: null,
        probation_end_date: null,
      };
    default:
      return null;
  }
}

const ROMAN_MONTHS = [
  "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII",
] as const;

export function romanMonth(month: number): string {
  return ROMAN_MONTHS[month - 1] ?? String(month);
}

/** Nomor kontrak: "0001/PKWT/VII/2026". */
export function buildContractNumber(type: ContractType, seq: number, date: Date): string {
  const number = String(seq).padStart(4, "0");
  return `${number}/${type.toUpperCase()}/${romanMonth(date.getMonth() + 1)}/${date.getFullYear()}`;
}

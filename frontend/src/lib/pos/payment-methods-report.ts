/** Agregasi laporan jenis pembayaran POS (periode WIB + isi 0). */

export type PaymentReportGranularity = "day" | "month" | "year";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parsePaymentReportGranularity(
  value?: string | null
): PaymentReportGranularity {
  if (value === "month" || value === "year" || value === "day") return value;
  return "day";
}

/** Kunci periode dari tanggal kalender WIB (YYYY-MM-DD). */
export function periodKeyFromWibDate(
  wibDate: string,
  granularity: PaymentReportGranularity
): string {
  if (!DATE_RE.test(wibDate)) return wibDate;
  if (granularity === "day") return wibDate;
  if (granularity === "month") return wibDate.slice(0, 7);
  return wibDate.slice(0, 4);
}

function parseYmd(value: string): { y: number; m: number; d: number } {
  const [y, m, d] = value.split("-").map(Number);
  return { y, m, d };
}

function formatYmd(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Semua bucket periode di rentang inklusif (WIB calendar dates).
 * Bucket tanpa transaksi tetap ada supaya UI bisa menampilkan 0.
 */
export function enumerateReportPeriods(
  dateFrom: string,
  dateTo: string,
  granularity: PaymentReportGranularity
): string[] {
  if (!DATE_RE.test(dateFrom) || !DATE_RE.test(dateTo) || dateFrom > dateTo) {
    return [];
  }

  const periods: string[] = [];

  if (granularity === "day") {
    let cur = dateFrom;
    while (cur <= dateTo) {
      periods.push(cur);
      const { y, m, d } = parseYmd(cur);
      const next = new Date(Date.UTC(y, m - 1, d + 1));
      cur = formatYmd(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
    }
    return periods;
  }

  if (granularity === "month") {
    let { y, m } = parseYmd(dateFrom);
    const end = parseYmd(dateTo);
    while (y < end.y || (y === end.y && m <= end.m)) {
      periods.push(`${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`);
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    return periods;
  }

  let y = parseYmd(dateFrom).y;
  const endY = parseYmd(dateTo).y;
  while (y <= endY) {
    periods.push(String(y));
    y += 1;
  }
  return periods;
}

export function formatPeriodLabel(
  period: string,
  granularity: PaymentReportGranularity
): string {
  if (granularity === "year") return period;
  if (granularity === "month") {
    const [y, m] = period.split("-").map(Number);
    if (!y || !m) return period;
    return new Intl.DateTimeFormat("id-ID", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(y, m - 1, 1)));
  }
  if (!DATE_RE.test(period)) return period;
  const [y, m, d] = period.split("-").map(Number);
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** Kunci metode untuk GROUP BY — code katalog jika ada, else handler/method. */
export function paymentMethodKey(input: {
  payment_method?: string | null;
  payment_method_code?: string | null;
}): string {
  const code = String(input.payment_method_code || "")
    .trim()
    .toLowerCase();
  if (code) return code;
  const method = String(input.payment_method || "")
    .trim()
    .toLowerCase();
  if (method === "credit") return "credit_card";
  return method || "unknown";
}

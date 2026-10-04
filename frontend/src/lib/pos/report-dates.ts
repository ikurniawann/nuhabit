/** Tanggal operasional laporan POS — selalu kalender Asia/Jakarta. */

export function todayWib(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

/** Tanggal 1 bulan berjalan (WIB), ikut bulan berikutnya otomatis. */
export function firstDayOfMonthWib(now = new Date()): string {
  const [year, month] = todayWib(now).split("-");
  return `${year}-${month}-01`;
}

export function monthToDateWib(now = new Date()): {
  dateFrom: string;
  dateTo: string;
} {
  return {
    dateFrom: firstDayOfMonthWib(now),
    dateTo: todayWib(now),
  };
}

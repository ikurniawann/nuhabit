/** Tanggal kalender hari ini di Asia/Jakarta (WIB), format YYYY-MM-DD. */
export function todayWib(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

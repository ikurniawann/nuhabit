/** Tanggal kalender hari ini di Asia/Jakarta (WIB), format YYYY-MM-DD. */
export function todayWib(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

/** Geser hari kalender YYYY-MM-DD sebanyak n hari. */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

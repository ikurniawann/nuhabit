// Tanggal kalender venue (WIB) untuk UI ticketing, format YYYY-MM-DD.
// Geser tanggal: addDaysIso di lib/ticketing/calendar.ts.

export const todayIso = (now: Date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

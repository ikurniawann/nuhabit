import { indexHolidays, type HolidayIndex, type HolidayRow } from "./holidays";

/**
 * Pengambil hari libur sisi browser (EPIC-036). Dipakai kalender absensi dan
 * pratinjau jumlah hari di form pengajuan cuti.
 *
 * Sengaja TIDAK melempar: hari libur adalah lapisan penjelas di atas fitur yang
 * sudah berjalan. Kalau endpoint-nya bermasalah, kalender & form tetap tampil —
 * tanggal merahnya saja yang hilang. Angka yang mengikat tetap dihitung server
 * saat pengajuan disimpan.
 */
export async function fetchHolidayIndex(
  startIso: string,
  endIso: string
): Promise<HolidayIndex> {
  try {
    const res = await fetch(
      `/api/hris/holidays?start_date=${startIso}&end_date=${endIso}`
    );
    if (!res.ok) return indexHolidays([]);
    const json = (await res.json()) as { data?: HolidayRow[] };
    return indexHolidays(json.data ?? []);
  } catch {
    return indexHolidays([]);
  }
}

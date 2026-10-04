/** Pola shift mingguan di tab "Jadwal Shift" detail karyawan. */

export const SHIFT_DAY_NAMES = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];
export const SHIFT_OFF = "off";
const DAYS = [1, 2, 3, 4, 5, 6, 7];

/** pola[hari 1-7] = shift_id | "off" */
export type ShiftPatternDraft = Record<number, string>;

export interface ShiftScheduleRowLike {
  day_of_week: number;
  shift_id: string | null;
  effective_from: string;
  effective_to: string | null;
  shift_name: string | null;
}

/** Pola berjalan pada `today` (YYYY-MM-DD): baris efektif terbaru per hari. */
export function currentShiftPattern(
  rows: ShiftScheduleRowLike[],
  today: string
): ShiftPatternDraft {
  return Object.fromEntries(
    DAYS.map((day) => {
      const active = rows
        .filter(
          (r) =>
            r.day_of_week === day &&
            r.effective_from <= today &&
            (r.effective_to === null || r.effective_to >= today)
        )
        .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0];
      return [day, active?.shift_id ?? SHIFT_OFF];
    })
  );
}

export function shiftPatternPayload(pattern: ShiftPatternDraft) {
  return DAYS.map((day) => ({
    day_of_week: day,
    shift_id: pattern[day] === SHIFT_OFF ? null : pattern[day],
  }));
}

/** Lima pola terakhir, urut seperti dari API: "Sen Pagi, Sel Pagi" atau "libur semua". */
export function summarizeShiftHistory(rows: ShiftScheduleRowLike[], limit = 5) {
  const starts = [...new Set(rows.map((r) => r.effective_from))].slice(0, limit);
  return starts.map((from) => {
    const group = rows.filter((r) => r.effective_from === from);
    const summary = group
      .filter((r) => r.shift_name)
      .map((r) => `${SHIFT_DAY_NAMES[r.day_of_week - 1].slice(0, 3)} ${r.shift_name}`)
      .join(", ");
    return {
      from,
      to: group[0]?.effective_to ?? null,
      summary: summary || "libur semua",
    };
  });
}

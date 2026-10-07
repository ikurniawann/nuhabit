import { describe, expect, test } from "vitest";
import {
  buildScheduleMessage,
  computeNextRun,
  describeSchedule,
  reportScheduleSchema,
} from "./report-schedule";

/** Instant UTC untuk jam WIB tertentu (WIB = UTC+7). */
const wib = (y: number, m: number, d: number, hour: number, min = 0) =>
  new Date(Date.UTC(y, m - 1, d, hour - 7, min, 0));

const UUID = "11111111-1111-4111-8111-111111111111";

describe("report terjadwal (EPIC-050 T-4.3)", () => {
  test("harian: sebelum jam jadwal → hari ini, sesudah → besok", () => {
    const s = { frequency: "daily" as const, hour: 8, day_of_week: null, day_of_month: null };
    expect(computeNextRun(s, wib(2026, 9, 13, 6)).toISOString()).toBe(wib(2026, 9, 13, 8).toISOString());
    expect(computeNextRun(s, wib(2026, 9, 13, 9)).toISOString()).toBe(wib(2026, 9, 14, 8).toISOString());
    // tepat di jam jadwal dianggap sudah lewat, supaya tidak terkirim dua kali
    expect(computeNextRun(s, wib(2026, 9, 13, 8)).toISOString()).toBe(wib(2026, 9, 14, 8).toISOString());
  });

  test("mingguan: maju ke hari berikutnya yang cocok, lompat pekan bila sudah lewat", () => {
    // 13 Sep 2026 = Minggu (dow 0)
    const senin = { frequency: "weekly" as const, hour: 8, day_of_week: 1, day_of_month: null };
    expect(computeNextRun(senin, wib(2026, 9, 13, 10)).toISOString()).toBe(wib(2026, 9, 14, 8).toISOString());
    const minggu = { frequency: "weekly" as const, hour: 8, day_of_week: 0, day_of_month: null };
    expect(computeNextRun(minggu, wib(2026, 9, 13, 6)).toISOString()).toBe(wib(2026, 9, 13, 8).toISOString());
    expect(computeNextRun(minggu, wib(2026, 9, 13, 10)).toISOString()).toBe(wib(2026, 9, 20, 8).toISOString());
  });

  test("bulanan: tanggal bulan ini bila belum lewat, jika tidak bulan depan (termasuk ganti tahun)", () => {
    const s = { frequency: "monthly" as const, hour: 7, day_of_week: null, day_of_month: 5 };
    expect(computeNextRun(s, wib(2026, 9, 1, 0)).toISOString()).toBe(wib(2026, 9, 5, 7).toISOString());
    expect(computeNextRun(s, wib(2026, 9, 20, 0)).toISOString()).toBe(wib(2026, 10, 5, 7).toISOString());
    expect(computeNextRun(s, wib(2026, 12, 20, 0)).toISOString()).toBe(wib(2027, 1, 5, 7).toISOString());
  });

  test("hasil selalu sesudah waktu acuan", () => {
    const now = wib(2026, 9, 13, 8, 30);
    for (const s of [
      { frequency: "daily" as const, hour: 8, day_of_week: null, day_of_month: null },
      { frequency: "weekly" as const, hour: 8, day_of_week: 0, day_of_month: null },
      { frequency: "monthly" as const, hour: 8, day_of_week: null, day_of_month: 13 },
    ]) {
      expect(computeNextRun(s, now).getTime()).toBeGreaterThan(now.getTime());
    }
  });

  test("skema: mingguan wajib hari, bulanan wajib tanggal, penerima minimal satu", () => {
    const base = { report_id: UUID, name: "Rekap", recipients: [{ type: "user", user_id: UUID }] };
    expect(reportScheduleSchema.safeParse({ ...base, frequency: "weekly" }).success).toBe(false);
    expect(reportScheduleSchema.safeParse({ ...base, frequency: "weekly", day_of_week: 1 }).success).toBe(true);
    expect(reportScheduleSchema.safeParse({ ...base, frequency: "monthly" }).success).toBe(false);
    expect(reportScheduleSchema.safeParse({ ...base, frequency: "monthly", day_of_month: 1 }).success).toBe(true);
    expect(reportScheduleSchema.safeParse({ ...base, frequency: "daily", recipients: [] }).success).toBe(false);
    expect(reportScheduleSchema.safeParse({ ...base, frequency: "daily", hour: 24 }).success).toBe(false);
    expect(reportScheduleSchema.safeParse({ ...base, frequency: "monthly", day_of_month: 31 }).success).toBe(false);
    expect(reportScheduleSchema.safeParse({ ...base, frequency: "daily", recipients: [{ type: "number", number: "628123456789" }] }).success).toBe(true);
  });

  test("deskripsi & pesan WA", () => {
    expect(describeSchedule({ frequency: "weekly", hour: 8, day_of_week: 1, day_of_month: null })).toBe("Mingguan · Senin 08:00 WIB");
    expect(describeSchedule({ frequency: "daily", hour: 17, day_of_week: null, day_of_month: null })).toBe("Harian · 17:00 WIB");
    expect(describeSchedule({ frequency: "monthly", hour: 9, day_of_week: null, day_of_month: 3 })).toBe("Bulanan · tanggal 3 09:00 WIB");
    const msg = buildScheduleMessage("Pipeline per PJ", "• Ani — Total: Rp 10.000.000", { rowCount: 3, periodLabel: "Bulan ini", url: "/x" });
    expect(msg).toContain("*Pipeline per PJ*");
    expect(msg).toContain("Periode: Bulan ini · 3 baris");
    expect(msg).toContain("Buka: /x");
  });
});

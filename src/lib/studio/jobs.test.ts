import { describe, expect, it } from "vitest";
import {
  DEFAULT_JOB_SETTINGS,
  dailyCloseDue,
  dedupKey,
  inSendWindow,
  longDate,
  passExpiringMessage,
  passLowMessage,
  scheduledRemindersDue,
  sessionReminderMessage,
  waitlistPromotedMessage,
  wibNow,
} from "./jobs";

/** Jam WIB tertentu pada 2026-10-02 (UTC = WIB − 7). */
const at = (hourWib: number, minute = 0) => new Date(Date.UTC(2026, 9, 2, hourWib - 7, minute));

describe("jadwal job", () => {
  it("wibNow memakai zona WIB", () => {
    expect(wibNow(new Date(Date.UTC(2026, 9, 2, 18, 30)))).toEqual({ date: "2026-10-03", hour: 1 });
  });

  it("tutup hari jalan sekali setelah jam tutup, dan dikejar bila terlewat", () => {
    const s = DEFAULT_JOB_SETTINGS;
    expect(dailyCloseDue(s, at(22, 59), null)).toBe(false);
    expect(dailyCloseDue(s, at(23, 5), null)).toBe(true);
    expect(dailyCloseDue(s, at(23, 30), "2026-10-02")).toBe(false);
    expect(dailyCloseDue(s, at(23, 30), "2026-10-01")).toBe(true);
    expect(dailyCloseDue({ ...s, auto_close_enabled: false }, at(23, 30), null)).toBe(false);
  });

  it("pengingat hanya di jam layak & setelah reminder_hour, dan hanya bila dinyalakan", () => {
    const on = { ...DEFAULT_JOB_SETTINGS, reminders_enabled: true };
    expect(inSendWindow(at(7, 59))).toBe(false);
    expect(inSendWindow(at(8))).toBe(true);
    expect(inSendWindow(at(21))).toBe(false);
    expect(scheduledRemindersDue(on, at(18, 59))).toBe(false);
    expect(scheduledRemindersDue(on, at(19, 10))).toBe(true);
    expect(scheduledRemindersDue(on, at(21, 10))).toBe(false);
    expect(scheduledRemindersDue(DEFAULT_JOB_SETTINGS, at(19, 10))).toBe(false);
  });
});

describe("isi pesan", () => {
  it("H-1 kelas & Personal Training, tanpa singkatan PT", () => {
    const m = sessionReminderMessage({ name: "Ilham Kurniawan", program: "Hyrox Engine", kind: "class", time: "06:30:00", coach: "Coach Pras", cancelWindowHours: 12 });
    expect(m).toContain("Halo Ilham, sesi berikutnya menunggu.");
    expect(m).toContain("Besok 06.30 — Hyrox Engine bersama Coach Pras.");
    expect(m).toContain("12 jam");
    const pt = sessionReminderMessage({ name: null, program: "Strength 1:1", kind: "pt", time: "09:00", coach: null, cancelWindowHours: 12 });
    expect(pt).toContain("Halo Atlet");
    expect(pt).toContain("sesi Personal Training Strength 1:1");
    expect(pt).not.toMatch(/\bPT\b/);
  });

  it("waitlist, kredit habis, paket berakhir", () => {
    expect(longDate("2026-10-03")).toBe("Sabtu, 3 Oktober");
    expect(waitlistPromotedMessage({ name: "Maya", program: "Hyrox Engine", date: "2026-10-03", time: "17:00" })).toContain("Sabtu, 3 Oktober pukul 17.00");
    expect(passLowMessage({ name: "Maya", product: "10 Kelas", left: 1 })).toContain("tinggal 1 sesi lagi");
    expect(passExpiringMessage({ name: "Maya", product: "10 Kelas", validUntil: "2026-10-05", left: 3 })).toContain("Senin, 5 Oktober");
  });

  it("kunci dedup unik per kejadian", () => {
    expect(dedupKey.session("b1")).toBe("session:b1");
    expect(dedupKey.passLow("p1", 1)).not.toBe(dedupKey.passLow("p1", 2));
  });
});

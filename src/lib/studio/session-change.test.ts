import { describe, expect, it } from "vitest";
import {
  canSendChangeNow,
  coachChangedMessage,
  freeCancelAfterCoachChange,
  isChangeNoticeLate,
  nextSendWindowOpen,
  sessionCancelledMessage,
} from "./session-change";

const wib = (iso: string) => new Date(`${iso}+07:00`);

describe("isChangeNoticeLate", () => {
  it("kurang dari N jam sebelum kelas = terlambat", () => {
    const start = wib("2026-11-02T07:00:00");
    expect(isChangeNoticeLate(start, wib("2026-11-01T18:00:00"), 12)).toBe(false); // 13 jam
    expect(isChangeNoticeLate(start, wib("2026-11-01T20:00:00"), 12)).toBe(true); // 11 jam
  });
});

describe("jam tenang", () => {
  it("08.00 berikutnya: sebelum jam 8 = hari itu, sesudah jam 21 = besok", () => {
    expect(nextSendWindowOpen(wib("2026-11-02T05:30:00")).toISOString()).toBe(wib("2026-11-02T08:00:00").toISOString());
    expect(nextSendWindowOpen(wib("2026-11-01T22:00:00")).toISOString()).toBe(wib("2026-11-02T08:00:00").toISOString());
  });

  it("di jam layak selalu kirim", () => {
    expect(canSendChangeNow(wib("2026-11-01T10:00:00"), wib("2026-11-20T07:00:00"))).toBe(true);
  });

  it("malam hari: kelas jauh ditahan, kelas pagi buta dikirim sekarang", () => {
    const night = wib("2026-11-01T22:00:00");
    expect(canSendChangeNow(night, wib("2026-11-03T07:00:00"))).toBe(false);
    expect(canSendChangeNow(night, wib("2026-11-02T12:00:00"))).toBe(false); // 08.00 + 3 jam = 11.00 < 12.00
    expect(canSendChangeNow(night, wib("2026-11-02T10:00:00"))).toBe(true);
    expect(canSendChangeNow(wib("2026-11-02T05:30:00"), wib("2026-11-02T07:00:00"))).toBe(true);
  });
});

describe("freeCancelAfterCoachChange", () => {
  it("hanya booking yang dibuat sebelum coach diganti", () => {
    expect(freeCancelAfterCoachChange("2026-10-20T10:00:00Z", "2026-10-21T10:00:00Z")).toBe(true);
    expect(freeCancelAfterCoachChange("2026-10-22T10:00:00Z", "2026-10-21T10:00:00Z")).toBe(false);
    expect(freeCancelAfterCoachChange("2026-10-20T10:00:00Z", null)).toBe(false);
  });
});

describe("pesan member (bahasa Inggris)", () => {
  const base = { name: "Maya Kusuma", program: "Hyrox Engine", kind: "class", date: "2026-11-02", time: "07:00:00", waitlisted: false, link: "https://x/member" };

  it("coach diganti: coach baru, coach lama, batal gratis, link", () => {
    const msg = coachChangedMessage({ ...base, newCoach: "Coach Rara", oldCoach: "Coach Pras" });
    expect(msg).toContain("Hi Maya");
    expect(msg).toContain("Monday, 2 November at 07:00");
    expect(msg).toContain("Coach Rara will coach this session instead of Coach Pras");
    expect(msg).toContain("credit comes back in full");
    expect(msg).toContain("https://x/member");
  });

  it("kelas batal: kredit kembali; waitlist tidak memakai kredit; Personal Training disebut lengkap", () => {
    expect(sessionCancelledMessage(base)).toContain("Your credit is back on your pass.");
    expect(sessionCancelledMessage({ ...base, waitlisted: true })).toContain("no credit was used");
    expect(sessionCancelledMessage({ ...base, program: "Strength 1:1", kind: "pt" })).toContain("your Personal Training session (Strength 1:1)");
  });
});

import { describe, expect, it } from "vitest";
import { checkReschedule, coachRescheduledMessage, freeCancelAfterStudioReschedule, memberRescheduledMessage } from "./pt-reschedule";

// 1 Nov 2026 10.00 WIB
const now = Date.parse("2026-11-01T10:00:00+07:00");
const base = {
  nowMs: now,
  from: { date: "2026-11-03", time: "07:00" },
  to: { date: "2026-11-04", time: "18:00" },
  cancelWindowHours: 12,
  memberCount: 0,
  memberMax: 2,
};

describe("checkReschedule", () => {
  it("member: boleh sebelum batas batal dan selama kuota masih ada", () => {
    expect(checkReschedule({ ...base, actor: "member" })).toEqual({ ok: true });
    expect(checkReschedule({ ...base, actor: "member", memberCount: 1 })).toEqual({ ok: true });
  });

  it("member: kuota habis / dimatikan / lewat batas batal → ditolak (bahasa Inggris)", () => {
    expect(checkReschedule({ ...base, actor: "member", memberCount: 2 })).toMatchObject({ ok: false, reason: expect.stringContaining("limit 2") });
    expect(checkReschedule({ ...base, actor: "member", memberMax: 0 })).toMatchObject({ ok: false, reason: expect.stringContaining("contact the studio") });
    const soon = { date: "2026-11-01", time: "21:30" }; // 11,5 jam lagi
    expect(checkReschedule({ ...base, actor: "member", from: soon })).toMatchObject({ ok: false, reason: expect.stringContaining("12 hours") });
    expect(checkReschedule({ ...base, actor: "member", from: { date: "2026-11-01", time: "22:00" } })).toEqual({ ok: true });
  });

  it("coach & staf: kapan pun sebelum sesi mulai, tanpa kuota (bahasa Indonesia)", () => {
    const soon = { date: "2026-11-01", time: "10:30" };
    expect(checkReschedule({ ...base, actor: "coach", from: soon, memberCount: 9 })).toEqual({ ok: true });
    expect(checkReschedule({ ...base, actor: "staff", from: { date: "2026-11-01", time: "09:00" } })).toEqual({
      ok: false,
      reason: "Sesi sudah mulai — tidak bisa dipindah",
    });
  });

  it("jadwal baru harus di masa depan dan berbeda dari jadwal lama", () => {
    expect(checkReschedule({ ...base, actor: "staff", to: { date: "2026-11-01", time: "09:30" } })).toMatchObject({ ok: false, reason: "Jadwal baru sudah lewat" });
    expect(checkReschedule({ ...base, actor: "member", to: base.from })).toMatchObject({ ok: false, reason: expect.stringContaining("same time") });
  });
});

describe("freeCancelAfterStudioReschedule", () => {
  it("hanya booking yang dibuat sebelum sesi dipindah studio", () => {
    expect(freeCancelAfterStudioReschedule("2026-10-30T10:00:00Z", "2026-10-31T10:00:00Z")).toBe(true);
    expect(freeCancelAfterStudioReschedule("2026-11-01T10:00:00Z", "2026-10-31T10:00:00Z")).toBe(false);
    expect(freeCancelAfterStudioReschedule("2026-10-30T10:00:00Z", null)).toBe(false);
  });
});

describe("pesan reschedule", () => {
  it("member: jadwal baru, jadwal lama, kredit tetap, catatan, tautan", () => {
    const m = memberRescheduledMessage({
      name: "Maya Putri",
      program: "Strength",
      from: { date: "2026-11-03", time: "07:00:00" },
      to: { date: "2026-11-04", time: "18:00" },
      coach: "Coach Pras",
      reason: "Coach ada event",
      link: "https://x/member",
    });
    expect(m).toContain("Hi Maya, your Personal Training session (Strength) has been moved.");
    expect(m).toMatch(/New time: .*4 Nov.* at 18:00 with Coach Pras \(was .*3 Nov.* at 07:00\)/);
    expect(m).toContain("Your credit stays the same");
    expect(m).toContain("Note from the studio: Coach ada event");
    expect(m).toContain("https://x/member");
  });

  it("coach: dipindah member / coach baru / coach lama", () => {
    const base2 = { coachName: "Coach Pras", member: "Maya", program: "Strength", from: base.from, to: base.to, portalUrl: "https://x/coach" };
    expect(coachRescheduledMessage({ ...base2, actor: "member", role: "same" })).toMatch(/dipindah oleh member: .*07:00 → .*18:00/);
    expect(coachRescheduledMessage({ ...base2, actor: "staff", role: "incoming" })).toContain("Anda mendapat sesi Personal Training Strength dengan Maya");
    const out = coachRescheduledMessage({ ...base2, actor: "staff", role: "outgoing", otherCoach: "Coach Rara", reason: "Pras cuti" });
    expect(out).toContain("dipindahkan ke Coach Rara — slot Anda kosong");
    expect(out).toContain("Alasan: Pras cuti");
  });
});

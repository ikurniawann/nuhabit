import { describe, expect, it } from "vitest";
import {
  blackoutConflicts,
  blackoutRejectionMessage,
  canDecideCoachLeave,
  DEFAULT_NOTICE_RULES,
  evaluateLeaveNotice,
  normalizeNoticeRules,
  noticeRejectionMessage,
  shortNoticeMessage,
  summarizeImpact,
  resolveLeaveApprovers,
  type ApproverCandidate,
} from "./coach-leave";

const pd = (userId: string, onLeave = false): ApproverCandidate => ({ userId, name: userId.toUpperCase(), onLeave });

describe("resolveLeaveApprovers", () => {
  it("memakai semua Program Director yang tidak cuti", () => {
    const r = resolveLeaveApprovers({ programDirectors: [pd("a"), pd("b", true), pd("c")], backup: pd("z") });
    expect(r.source).toBe("program_director");
    expect(r.approvers.map((a) => a.userId)).toEqual(["a", "c"]);
  });

  it("jatuh ke approver cadangan saat semua Program Director cuti", () => {
    const r = resolveLeaveApprovers({ programDirectors: [pd("a", true)], backup: pd("z") });
    expect(r).toEqual({ approvers: [pd("z")], source: "backup" });
  });

  it("jatuh ke cadangan saat belum ada Program Director", () => {
    expect(resolveLeaveApprovers({ programDirectors: [], backup: pd("z") }).source).toBe("backup");
  });

  it("Program Director tidak memutus cutinya sendiri", () => {
    const r = resolveLeaveApprovers({ programDirectors: [pd("a")], backup: pd("z"), requesterUserId: "a" });
    expect(r).toEqual({ approvers: [pd("z")], source: "backup" });
  });

  it("hanya Super Admin bila cadangan juga cuti, kosong, atau pengaju", () => {
    expect(resolveLeaveApprovers({ programDirectors: [pd("a", true)], backup: pd("z", true) }).source).toBe("super_admin");
    expect(resolveLeaveApprovers({ programDirectors: [], backup: null })).toEqual({ approvers: [], source: "super_admin" });
    expect(resolveLeaveApprovers({ programDirectors: [], backup: pd("z"), requesterUserId: "z" }).source).toBe("super_admin");
  });
});

describe("canDecideCoachLeave", () => {
  const resolved = resolveLeaveApprovers({ programDirectors: [pd("a")], backup: pd("z") });

  it("approver yang ter-resolve boleh memutus", () => {
    expect(canDecideCoachLeave({ id: "a", role: "program_director" }, resolved)).toBe(true);
  });

  it("cadangan tidak memutus selama ada Program Director aktif", () => {
    expect(canDecideCoachLeave({ id: "z", role: "admin" }, resolved)).toBe(false);
  });

  it("admin biasa tidak memutus; Super Admin selalu boleh menggantikan", () => {
    expect(canDecideCoachLeave({ id: "x", role: "admin" }, resolved)).toBe(false);
    expect(canDecideCoachLeave({ id: "s", role: "super_admin" }, resolved)).toBe(true);
  });

  it("tidak ada yang memutus pengajuannya sendiri, termasuk Super Admin", () => {
    expect(canDecideCoachLeave({ id: "a", role: "program_director" }, resolved, "a")).toBe(false);
    expect(canDecideCoachLeave({ id: "s", role: "super_admin" }, resolved, "s")).toBe(false);
  });
});

describe("evaluateLeaveNotice", () => {
  const h7 = { min_days: 7, allow_short_notice: false, blackout: true };
  const sick = { min_days: 1, allow_short_notice: true, blackout: false };

  it("tepat H-7 atau lebih → diterima, tidak mendadak", () => {
    expect(evaluateLeaveNotice(h7, "2026-10-28", "2026-10-21")).toEqual({ ok: true, shortNotice: false, noticeDays: 7 });
    expect(evaluateLeaveNotice(h7, "2026-11-30", "2026-10-21")).toMatchObject({ ok: true, shortNotice: false });
  });

  it("di bawah H-7 untuk jenis yang tidak dikecualikan → ditolak dengan tanggal paling cepat", () => {
    expect(evaluateLeaveNotice(h7, "2026-10-27", "2026-10-21")).toEqual({ ok: false, noticeDays: 6, earliestStart: "2026-10-28" });
  });

  it("melewati akhir bulan & tahun dengan benar", () => {
    expect(evaluateLeaveNotice(h7, "2027-01-03", "2026-12-28")).toMatchObject({ ok: false, earliestStart: "2027-01-04" });
  });

  it("sakit diajukan sehari sebelumnya → biasa; di hari H atau mundur → mendadak", () => {
    expect(evaluateLeaveNotice(sick, "2026-10-22", "2026-10-21")).toMatchObject({ ok: true, shortNotice: false });
    expect(evaluateLeaveNotice(sick, "2026-10-21", "2026-10-21")).toEqual({ ok: true, shortNotice: true, noticeDays: 0 });
    expect(evaluateLeaveNotice(sick, "2026-10-19", "2026-10-21")).toEqual({ ok: true, shortNotice: true, noticeDays: -2 });
  });

  it("min_days 0 = tanpa minimal hari, tetapi tanggal mundur tetap ditolak", () => {
    const none = { min_days: 0, allow_short_notice: false, blackout: false };
    expect(evaluateLeaveNotice(none, "2026-10-21", "2026-10-21")).toMatchObject({ ok: true, shortNotice: false });
    expect(evaluateLeaveNotice(none, "2026-10-20", "2026-10-21")).toMatchObject({ ok: false, earliestStart: "2026-10-21" });
  });
});

describe("normalizeNoticeRules", () => {
  it("kosong / bukan objek → default", () => {
    expect(normalizeNoticeRules(null)).toEqual(DEFAULT_NOTICE_RULES);
    expect(normalizeNoticeRules("x")).toEqual(DEFAULT_NOTICE_RULES);
  });

  it("menimpa per jenis, sisanya default; nilai rusak diabaikan dan dibatasi 0–90", () => {
    const r = normalizeNoticeRules({
      annual: { min_days: 14 },
      sick: { allow_short_notice: false, blackout: true },
      unpaid: { min_days: 500 },
      maternity: { min_days: -3, allow_short_notice: "ya" },
      marriage: { min_days: 2.5, blackout: "tidak" },
    });
    expect(r.annual).toEqual({ min_days: 14, allow_short_notice: false, blackout: true });
    expect(r.sick).toEqual({ min_days: 1, allow_short_notice: false, blackout: true });
    expect(r.unpaid.min_days).toBe(90);
    expect(r.maternity).toEqual({ min_days: 0, allow_short_notice: false, blackout: false });
    expect(r.marriage).toEqual(DEFAULT_NOTICE_RULES.marriage);
    expect(r.pilgrimage).toEqual(DEFAULT_NOTICE_RULES.pilgrimage);
  });
});

describe("blackoutConflicts", () => {
  const annual = DEFAULT_NOTICE_RULES.annual;
  const event = { id: "e", date_from: "2026-11-14", date_to: "2026-11-16", reason: "Hyrox Jakarta" };
  const promo = { id: "p", date_from: "2026-12-31", date_to: "2026-12-31", reason: "Tutup tahun" };

  it("default: cuti terencana kena blackout, sakit/darurat/hak normatif tidak", () => {
    expect(["annual", "unpaid", "marriage"].every((t) => DEFAULT_NOTICE_RULES[t as "annual"].blackout)).toBe(true);
    expect(["sick", "emergency", "menstrual", "paternity", "bereavement", "maternity", "pilgrimage"].some((t) => DEFAULT_NOTICE_RULES[t as "sick"].blackout)).toBe(false);
  });

  it("beririsan di tepi rentang (inklusif) → konflik; berdampingan → tidak", () => {
    expect(blackoutConflicts(annual, [event, promo], "2026-11-10", "2026-11-14")).toEqual([event]);
    expect(blackoutConflicts(annual, [event, promo], "2026-11-16", "2026-11-20")).toEqual([event]);
    expect(blackoutConflicts(annual, [event, promo], "2026-11-15", "2026-11-15")).toEqual([event]);
    expect(blackoutConflicts(annual, [event, promo], "2026-11-10", "2026-11-13")).toEqual([]);
    expect(blackoutConflicts(annual, [event, promo], "2026-11-17", "2026-11-20")).toEqual([]);
    expect(blackoutConflicts(annual, [event, promo], "2026-11-01", "2026-12-31")).toEqual([event, promo]);
  });

  it("jenis cuti yang tidak kena blackout → selalu kosong", () => {
    expect(blackoutConflicts(DEFAULT_NOTICE_RULES.sick, [event], "2026-11-15", "2026-11-15")).toEqual([]);
  });

  it("pesan penolakan menyebut rentang dan alasan", () => {
    const msg = blackoutRejectionMessage("annual", [event, promo]);
    expect(msg).toContain("Cuti Tahunan");
    expect(msg).toMatch(/14 Nov 2026 – .*16 Nov 2026 \(Hyrox Jakarta\)/);
    expect(msg).toMatch(/31 Des 2026 \(Tutup tahun\)/);
  });
});

describe("pesan aturan H-N", () => {
  it("penolakan menyebut jenis, H-N, dan tanggal paling cepat", () => {
    const msg = noticeRejectionMessage("annual", { min_days: 7, allow_short_notice: false, blackout: true }, "2026-10-28");
    expect(msg).toContain("Cuti Tahunan");
    expect(msg).toContain("H-7");
    expect(msg).toMatch(/28 Okt 2026/);
  });

  it("cuti mendadak menyebut H-0 atau hari setelah tanggal mulai", () => {
    const rule = { min_days: 1, allow_short_notice: true, blackout: false };
    expect(shortNoticeMessage(rule, 0)).toBe("Tercatat sebagai cuti mendadak (diajukan H-0, SOP minimal H-1).");
    expect(shortNoticeMessage(rule, -2)).toContain("2 hari setelah tanggal mulai");
  });
});

describe("summarizeImpact", () => {
  const sess = (kind: string, booked: number) => ({
    id: kind + booked, session_date: "2026-10-28", start_time: "07:00", end_time: "08:00", program_name: "X", program_kind: kind, booked_count: booked,
  });

  it("menghitung kelas, Personal Training, dan member yang sudah booking", () => {
    expect(summarizeImpact([sess("class", 8), sess("pt", 1), sess("class", 0)])).toEqual({ classes: 2, pt: 1, members: 9 });
    expect(summarizeImpact([])).toEqual({ classes: 0, pt: 0, members: 0 });
  });
});

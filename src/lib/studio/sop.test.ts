import { describe, expect, it } from "vitest";
import { DEFAULT_DISCIPLINE_RULES } from "./coach-discipline";
import { DEFAULT_NOTICE_RULES } from "./coach-leave";
import { DEFAULT_COMPLAINT_SLA } from "./complaints";
import { buildSopCoachTemplate, sopReminderMessage } from "./sop";

describe("template SOP coach", () => {
  const base = {
    noticeRules: DEFAULT_NOTICE_RULES,
    substituteResponseHours: 24,
    memberNoticeMinHours: 12,
    slaRules: DEFAULT_COMPLAINT_SLA,
    discipline: DEFAULT_DISCIPLINE_RULES,
  };

  it("memuat angka dari pengaturan yang berlaku", () => {
    const t = buildSopCoachTemplate(base);
    expect(t).toContain("Cuti Tahunan: minimal H-7");
    expect(t).toContain("Melahirkan: minimal H-30");
    expect(t).toContain("paling lambat 1 hari");
    expect(t).toContain("Tidak hadir tanpa kabar: potongan 15%");
    expect(t).toContain("3 pelanggaran dalam 90 hari");
    expect(t).toContain("Cedera: respons ≤ 2 jam, selesai ≤ 1 hari");
    expect(t).toContain("Coach: respons ≤ 1 hari, selesai ≤ 3 hari");
  });

  it("ikut berubah bila pengaturan diubah", () => {
    const t = buildSopCoachTemplate({
      ...base,
      noticeRules: { ...DEFAULT_NOTICE_RULES, annual: { min_days: 14, allow_short_notice: false } },
      discipline: { ...DEFAULT_DISCIPLINE_RULES, max_deduction_percent: 30 },
      substituteResponseHours: 6,
    });
    expect(t).toContain("Cuti Tahunan: minimal H-14");
    expect(t).toContain("maksimal 30% per bulan");
    expect(t).toContain("paling lambat 6 jam");
  });

  it("pesan pengingat memuat judul, versi, dan tautan", () => {
    const m = sopReminderMessage({ coachName: "Coach Pras", title: "SOP Coach", version: 2, portalUrl: "https://x/coach" });
    expect(m).toContain("SOP Coach (versi 2)");
    expect(m).toContain("https://x/coach");
  });
});

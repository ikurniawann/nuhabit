import { describe, expect, it } from "vitest";
import {
  backofficeCanManage,
  coachCanSeeMedical,
  flagTypeCode,
  isFlagActive,
  redactForBackoffice,
  sortFlags,
  type FlagCategory,
  type FlagSeverity,
} from "./member-flags";

describe("isFlagActive", () => {
  it("dihapus atau lewat masa berlaku = tidak aktif; tanpa masa berlaku = aktif", () => {
    expect(isFlagActive({ valid_until: null }, "2026-10-21")).toBe(true);
    expect(isFlagActive({ valid_until: "2026-10-21" }, "2026-10-21")).toBe(true);
    expect(isFlagActive({ valid_until: "2026-10-20" }, "2026-10-21")).toBe(false);
    expect(isFlagActive({ valid_until: null, removed_at: "2026-10-01T00:00:00Z" }, "2026-10-21")).toBe(false);
  });
});

describe("sortFlags", () => {
  const f = (id: string, severity: FlagSeverity, category: FlagCategory, created_at: string) => ({ id, severity, category, created_at });

  it("kritis dulu, medis sebelum umum, lalu terbaru", () => {
    const sorted = sortFlags([
      f("vip", "info", "general", "2026-10-10"),
      f("hamil", "attention", "medical", "2026-10-01"),
      f("pemula", "attention", "general", "2026-10-15"),
      f("cedera", "critical", "medical", "2026-09-01"),
      f("komplain", "attention", "general", "2026-10-18"),
    ]);
    expect(sorted.map((x) => x.id)).toEqual(["cedera", "hamil", "komplain", "pemula", "vip"]);
  });
});

describe("akses penanda medis", () => {
  it("backoffice hanya melihat jumlah medis, tidak isinya", () => {
    const view = redactForBackoffice([
      { id: "1", category: "general" as const, note: "VIP" },
      { id: "2", category: "medical" as const, note: "Lutut kiri" },
      { id: "3", category: "medical" as const, note: "Hamil 5 bulan" },
    ]);
    expect(view.general.map((x) => x.id)).toEqual(["1"]);
    expect(view.medical_count).toBe(2);
    expect(JSON.stringify(view)).not.toContain("Lutut");
  });

  it("coach melihat medis bila memegang sesi berjalan/mendatang atau pembuatnya", () => {
    expect(coachCanSeeMedical({ holdsCurrentSession: true, createdByMe: false })).toBe(true);
    expect(coachCanSeeMedical({ holdsCurrentSession: false, createdByMe: true })).toBe(true);
    expect(coachCanSeeMedical({ holdsCurrentSession: false, createdByMe: false })).toBe(false);
  });

  it("backoffice hanya boleh mengelola penanda umum", () => {
    expect(backofficeCanManage("general")).toBe(true);
    expect(backofficeCanManage("medical")).toBe(false);
  });
});

describe("flagTypeCode", () => {
  it("label → kode aman", () => {
    expect(flagTypeCode("Atlet Kompetisi")).toBe("atlet_kompetisi");
    expect(flagTypeCode("  Lansia (60+) ")).toBe("lansia_60");
    expect(flagTypeCode("!!!")).toBe("flag");
  });
});

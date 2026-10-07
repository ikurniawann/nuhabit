import { describe, expect, test } from "vitest";
import {
  OPTOUT_FOOTER,
  buildSegmentFilter,
  isWithinSendWindow,
  normalizeSegment,
  renderCampaignMessage,
  validateTemplate,
} from "./campaigns";

describe("normalizeSegment", () => {
  test("input kosong → segmen kosong yang valid", () => {
    expect(normalizeSegment({})).toEqual({
      last_visit_days: null,
      tiers: [],
      min_xp: null,
    });
  });

  test("nilai sampah dibuang, bukan jadi 0 diam-diam", () => {
    expect(
      normalizeSegment({ last_visit_days: "abc", min_xp: -5, tiers: "x" })
    ).toEqual({ last_visit_days: null, tiers: [], min_xp: null });
  });

  test("nilai sah dipertahankan (dibulatkan int)", () => {
    expect(
      normalizeSegment({ last_visit_days: 60.9, min_xp: 100, tiers: ["gold"] })
    ).toEqual({ last_visit_days: 60, tiers: ["gold"], min_xp: 100 });
  });
});

describe("buildSegmentFilter", () => {
  test("segmen kosong → hanya guard dasar (aktif + ada phone)", () => {
    const f = buildSegmentFilter(
      { last_visit_days: null, tiers: [], min_xp: null },
      3
    );
    expect(f.where).toContain("is_active = true");
    expect(f.where).toContain("phone IS NOT NULL");
    expect(f.params).toEqual([]);
  });

  test("win-back: last_visit_days memakai interval hari + param urut", () => {
    const f = buildSegmentFilter(
      { last_visit_days: 60, tiers: ["gold", "silver"], min_xp: 500 },
      3
    );
    // placeholder mulai dari $3 (pemanggil sudah memakai $1..$2)
    expect(f.where).toContain("$3");
    expect(f.where).toContain("$4");
    expect(f.where).toContain("$5");
    expect(f.params).toEqual([60, ["gold", "silver"], 500]);
    // member yang belum pernah datang TIDAK termasuk win-back
    expect(f.where).toContain("last_visit IS NOT NULL");
  });
});

describe("renderCampaignMessage", () => {
  test("placeholder {nama} dan {kode} terganti + footer opt-out menempel", () => {
    const out = renderCampaignMessage("Halo {nama}, pakai kode {kode} ya!", {
      nama: "Budi",
      kode: "WIN-ABC123",
    });
    expect(out).toContain("Halo Budi, pakai kode WIN-ABC123 ya!");
    expect(out.endsWith(OPTOUT_FOOTER)).toBe(true);
  });

  test("tanpa kode → placeholder {kode} dihapus rapi", () => {
    const out = renderCampaignMessage("Halo {nama} {kode}", {
      nama: "Ani",
      kode: null,
    });
    expect(out).not.toContain("{kode}");
    expect(out).toContain("Halo Ani");
  });
});

describe("validateTemplate", () => {
  test("mode batch WAJIB memuat {kode}", () => {
    expect(validateTemplate("Halo {nama}", "batch")).toEqual({
      ok: false,
      reason: "template-tanpa-kode",
    });
    expect(validateTemplate("Halo {nama}, kode: {kode}", "batch")).toEqual({
      ok: true,
    });
  });

  test("tanpa promo → {kode} justru dilarang (pesan bolong)", () => {
    expect(validateTemplate("Kode {kode}", null)).toEqual({
      ok: false,
      reason: "kode-tanpa-promo",
    });
    expect(validateTemplate("Halo {nama}", null)).toEqual({ ok: true });
  });
});

describe("isWithinSendWindow", () => {
  test("jam 8-21 WIB inklusif awal, eksklusif setelah 21", () => {
    expect(isWithinSendWindow(7)).toBe(false);
    expect(isWithinSendWindow(8)).toBe(true);
    expect(isWithinSendWindow(20)).toBe(true);
    expect(isWithinSendWindow(21)).toBe(false);
  });
});

import { describe, expect, it, vi } from "vitest";
import { fillUniqueCodes, inferPrefix, planCampaignUpdate, type CampaignSnapshot } from "./campaign-rules";

describe("fillUniqueCodes", () => {
  it("mengisi ulang kode yang bentrok sampai jumlah terpenuhi", async () => {
    let n = 0;
    const insert = vi
      .fn<(c: string[]) => Promise<string[]>>()
      .mockImplementationOnce(async (c) => c.slice(0, 1)) // satu bentrok
      .mockImplementationOnce(async (c) => c);
    const codes = await fillUniqueCodes({
      need: 2, generate: () => `K-${n++}`, insert, shortMessage: () => "kurang",
    });
    expect(codes).toHaveLength(2);
    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert.mock.calls[1][0]).toHaveLength(1);
  });

  it("gagal setelah maksimum ronde dengan pesan & status 500", async () => {
    let n = 0;
    await expect(
      fillUniqueCodes({
        need: 3, generate: () => `K-${n++}`, insert: async () => [], rounds: 2,
        shortMessage: (made, need) => `Hanya ${made}/${need}`,
      })
    ).rejects.toMatchObject({ status: 500, message: "Hanya 0/3" });
  });
});

describe("inferPrefix", () => {
  it("ambil prefix dari kode PREFIX-XXXXXX pertama yang cocok", () => {
    expect(inferPrefix(["MERDEKA45", "pos-ab12cd", "TIX-ZZZZZZ"])).toBe("POS");
    expect(inferPrefix(["PUBLIK"])).toBeNull();
  });
});

describe("planCampaignUpdate", () => {
  const fresh: CampaignSnapshot = { discount_type: "percent", value: "10", valid_from: null, valid_until: null, captured_count: "0" };
  const used: CampaignSnapshot = { ...fresh, captured_count: "3" };

  it("setelah ada voucher terpakai hanya saklar yang boleh", () => {
    expect(planCampaignUpdate({ is_active: false, show_in_member_portal: true }, used)).toEqual([
      ["is_active", false],
      ["show_in_member_portal", true],
    ]);
    expect(() => planCampaignUpdate({ name: "Baru" }, used)).toThrow(expect.objectContaining({ status: 409 }));
  });

  it("validasi gabungan dengan nilai tersimpan: persen ≤ 100, tanggal akhir ≥ mulai", () => {
    expect(() => planCampaignUpdate({ value: 150 }, fresh)).toThrow("Diskon persen maksimal 100");
    expect(() => planCampaignUpdate({ valid_until: "2026-01-01" }, { ...fresh, valid_from: "2026-02-01" }))
      .toThrow("Tanggal akhir sebelum tanggal mulai");
  });

  it("ganti ke nominal menghapus max_discount; member_baru membawa new_member_days", () => {
    expect(planCampaignUpdate({ discount_type: "fixed", value: 5000 }, fresh)).toEqual([
      ["discount_type", "fixed"],
      ["value", 5000],
      ["max_discount", null],
    ]);
    expect(planCampaignUpdate({ eligibility: "member", new_member_days: 30 }, fresh)).toEqual([
      ["eligibility", "member"],
      ["new_member_days", null],
    ]);
    expect(planCampaignUpdate({ eligibility: "member_baru", new_member_days: 30 }, fresh)).toEqual([
      ["eligibility", "member_baru"],
      ["new_member_days", 30],
    ]);
  });
});

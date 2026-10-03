import { describe, expect, it } from "vitest";
import {
  baseToPack,
  defaultIssuePack,
  defaultPurchasePackFor,
  defaultPurchasePack,
  evaluatePack,
  legacyPacks,
  packFactor,
  packLabel,
  packPriceToBase,
  packToBase,
  resolvePacks,
  splitToPacks,
  wholePacksFor,
  type ItemPack,
} from "./packs";
import { resolveBaseUnitFactor } from "./raw-material-units";

const PCS: ItemPack = { satuan_id: "pcs", qty_in_base_unit: 1, is_base: true, is_issue_default: true, unit_name: "PCS" };
const BOX: ItemPack = { satuan_id: "box", qty_in_base_unit: 12, is_base: false, unit_name: "BOX" };
const CTN: ItemPack = { satuan_id: "ctn", qty_in_base_unit: 48, is_base: false, is_purchase_default: true, unit_name: "KARTON" };

describe("konversi pack", () => {
  it("pack ke satuan dasar dan sebaliknya", () => {
    expect(packToBase(10, 24)).toBe(240);
    expect(baseToPack(84, 24)).toBe(3.5);
    expect(packToBase(2, 0)).toBe(2);
  });

  it("harga per pack ke harga per satuan dasar", () => {
    expect(packPriceToBase(396_000, 24)).toBe(16_500);
    expect(packPriceToBase(1000, 0)).toBe(1000);
  });

  it("memecah satuan dasar jadi pack utuh + sisa", () => {
    expect(splitToPacks(51, 24)).toEqual({ packs: 2, remainder: 3 });
    expect(splitToPacks(7, 1)).toEqual({ packs: 7, remainder: 0 });
  });

  it("label rak", () => {
    expect(packLabel(CTN, "PCS")).toBe("KARTON (48 PCS)");
    expect(packLabel(PCS, "PCS")).toBe("PCS");
  });
});

describe("pack bawaan", () => {
  it("PO memakai pack beli bawaan, pengeluaran memakai pack keluar bawaan", () => {
    expect(defaultPurchasePack([PCS, BOX, CTN])?.satuan_id).toBe("ctn");
    expect(defaultIssuePack([PCS, BOX, CTN])?.satuan_id).toBe("pcs");
  });

  it("jatuh ke pack dasar bila tidak ada bawaan", () => {
    expect(defaultPurchasePack([PCS, BOX])?.satuan_id).toBe("pcs");
  });

  it("mengabaikan pack nonaktif", () => {
    expect(defaultPurchasePack([PCS, { ...CTN, is_active: false }])?.satuan_id).toBe("pcs");
  });
});

describe("evaluatePack", () => {
  it("menolak isi nol, pack dasar bukan 1, satuan ganda, dan pecahan pada satuan hitung", () => {
    expect(evaluatePack([], { ...BOX, qty_in_base_unit: 0 })).toBe("FACTOR_NOT_POSITIVE");
    expect(evaluatePack([], { ...PCS, qty_in_base_unit: 2 })).toBe("BASE_FACTOR_NOT_ONE");
    expect(evaluatePack([PCS, BOX], { ...BOX, id: "baru" })).toBe("UNIT_ALREADY_DEFINED");
    expect(evaluatePack([], { ...BOX, qty_in_base_unit: 24.5 }, "count")).toBe("FRACTIONAL_COUNT");
    expect(evaluatePack([PCS], BOX, "count")).toBeNull();
  });

  it("mengizinkan mengubah pack yang sama", () => {
    expect(evaluatePack([{ ...BOX, id: "b1" }], { ...BOX, id: "b1", qty_in_base_unit: 10 })).toBeNull();
  });
});

describe("satuan besar/kecil lama sebagai dua pack", () => {
  const material = { satuan_besar_id: "dus", satuan_kecil_id: "pcs", konversi_factor: 12 };

  it("satuan kecil jadi pack dasar, satuan besar berisi konversi_factor", () => {
    expect(legacyPacks(material)).toEqual([
      { satuan_id: "pcs", qty_in_base_unit: 1, is_base: true, is_issue_default: true },
      { satuan_id: "dus", qty_in_base_unit: 12, is_base: false, is_purchase_default: true, is_issue_default: false },
    ]);
  });

  it("tanpa satuan kecil: satuan besar adalah dasar", () => {
    expect(legacyPacks({ satuan_besar_id: "kg", satuan_kecil_id: null, konversi_factor: 25 })).toEqual([
      { satuan_id: "kg", qty_in_base_unit: 1, is_base: true, is_purchase_default: true, is_issue_default: true },
    ]);
  });

  it("pack tersimpan menang, satuan lama yang belum ada ditambahkan", () => {
    const packs = resolvePacks(material, [{ satuan_id: "ctn", qty_in_base_unit: 48, is_base: false }]);
    expect(packs.map((p) => [p.satuan_id, p.qty_in_base_unit])).toEqual([
      ["ctn", 48],
      ["pcs", 1],
      ["dus", 12],
    ]);
  });

  it("konversi GRN: qty karton → satuan dasar", () => {
    const rows = [{ satuan_id: "ctn", qty_in_base_unit: 48, is_base: false }];
    expect(packFactor(material, rows, "ctn")).toBe(48);
    expect(packFactor(material, rows, "dus")).toBe(12);
    expect(packFactor(material, rows, "pcs")).toBe(1);
    expect(packFactor(material, rows, null)).toBe(12);
    expect(packToBase(3, packFactor(material, rows, "ctn"))).toBe(144);
    expect(resolveBaseUnitFactor(material, rows, "ctn")).toBe(48);
  });
});

describe("baris PO dari saran stok rendah", () => {
  it("memakai pack beli bawaan dan membulatkan ke pack utuh", () => {
    const material = { satuan_besar_id: "dus", satuan_kecil_id: "pcs", konversi_factor: 12, unit_conversions: [] };
    const pack = defaultPurchasePackFor(material)!;
    expect(pack.satuan_id).toBe("dus");
    expect(wholePacksFor(89, pack.qty_in_base_unit)).toBe(8);
    expect(wholePacksFor(0, 12)).toBe(0);
  });

  it("bahan baru tanpa flag bawaan tetap memesan dalam satuan besar", () => {
    const material = {
      satuan_besar_id: "dus",
      satuan_kecil_id: "pcs",
      konversi_factor: 12,
      unit_conversions: [
        { satuan_id: "pcs", qty_in_base_unit: 1, is_base: true },
        { satuan_id: "dus", qty_in_base_unit: 12, is_base: false },
      ],
    };
    expect(defaultPurchasePackFor(material)?.satuan_id).toBe("dus");
    expect(
      defaultPurchasePackFor({
        ...material,
        unit_conversions: [...material.unit_conversions, { satuan_id: "ctn", qty_in_base_unit: 48, is_purchase_default: true }],
      })?.satuan_id
    ).toBe("ctn");
  });
});

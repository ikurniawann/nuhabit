import { describe, expect, it } from "vitest";
import {
  countProgress,
  countedLineUpdates,
  linesFromPreview,
  qtyInputError,
  withSystemQty,
  withUnitMode,
  type CountLine,
} from "./count-lines";

const preview = [
  {
    inventory_id: null,
    raw_material_id: "gula",
    material_kode: "BB-1",
    material_nama: "Gula",
    satuan: "Kg",
    satuan_besar_nama: "Karung",
    satuan_kecil_nama: "Kg",
    konversi_factor: 50,
    qty_system: 2,
    unit_cost: 0,
  },
  {
    inventory_id: "inv",
    raw_material_id: "susu",
    material_kode: "BB-2",
    material_nama: "Susu",
    satuan: "L",
    qty_system: 10,
    unit_cost: 0,
  },
];

describe("linesFromPreview", () => {
  it("satuan kecil hanya untuk bahan yang punya konversi", () => {
    const lines = linesFromPreview(preview, "kecil");
    expect(lines.map((l) => l.input_unit_mode)).toEqual(["kecil", "besar"]);
    expect(lines[1].satuan_besar_nama).toBe("L");
  });
});

describe("rules", () => {
  const set = (line: CountLine, input: string) => ({
    ...line,
    qty_counted_input: input,
  });

  it("progress & validasi", () => {
    const [gula, susu] = linesFromPreview(preview, "besar");
    const lines = [set(gula, "2"), susu];
    expect(countProgress(lines)).toEqual({ counted: 1, variance: 0, total: 2 });
    expect(qtyInputError(lines, true)).toBe("1 baris belum dihitung");
    expect(qtyInputError([set(gula, "-1")], false)).toBe(
      "Qty fisik harus berupa angka lebih besar atau sama dengan nol",
    );
    expect(qtyInputError(lines, false)).toBeNull();
  });

  it("ganti satuan mengonversi input; stok sistem diisi di satuan baris", () => {
    const [gula] = linesFromPreview(preview, "besar");
    expect(withUnitMode(set(gula, "1"), "kecil").qty_counted_input).toBe("50");
    expect(withSystemQty(gula).qty_counted_input).toBe("2");
  });

  it("update hanya baris terhitung, dipetakan ke id sesi", () => {
    const [gula, susu] = linesFromPreview(preview, "kecil");
    expect(
      countedLineUpdates(
        [set(gula, "60"), susu],
        [{ id: "line-gula", raw_material_id: "gula" }],
      ),
    ).toEqual([{ id: "line-gula", qty_counted: 1.2 }]);
  });
});

import {
  baseQtyFromInput,
  convertQtyInputBetweenModes,
  displayQtyInputFromBase,
  hasSmallUnit,
  type RawMaterialUnitInfo,
  type RawMaterialUnitMode,
} from "@/lib/inventory/raw-material-units";
import type { StockOpnameLine, StockOpnamePreviewLine } from "./types";

/** Baris hitung opname bahan baku + aturan murninya (diuji unit). */

export type CountLine = {
  key: string;
  lineId?: string;
  raw_material_id: string;
  material_kode: string;
  material_nama: string;
  satuan: string | null;
  satuan_besar_nama: string | null;
  satuan_kecil_nama: string | null;
  konversi_factor: number | null;
  input_unit_mode: RawMaterialUnitMode;
  qty_system: number;
  qty_counted_input: string;
};

export function lineUnitInfo(line: RawMaterialUnitInfo): RawMaterialUnitInfo {
  return {
    satuan: line.satuan,
    satuan_besar_nama: line.satuan_besar_nama,
    satuan_kecil_nama: line.satuan_kecil_nama,
    konversi_factor: line.konversi_factor,
  };
}

/** Satuan kecil hanya bila bahan punya konversi; selain itu satuan besar/dasar. */
export function modeFor(
  info: RawMaterialUnitInfo,
  preferred: RawMaterialUnitMode,
): RawMaterialUnitMode {
  return preferred === "kecil" && hasSmallUnit(info) ? "kecil" : "besar";
}

type UnitSource = {
  satuan?: string | null;
  satuan_besar_nama?: string | null;
  satuan_kecil_nama?: string | null;
  konversi_factor?: number | null;
};

type LineUnits = {
  satuan: string | null;
  satuan_besar_nama: string | null;
  satuan_kecil_nama: string | null;
  konversi_factor: number | null;
};

/** Info satuan baris; satuan besar jatuh ke satuan dasar bila kosong. */
export function unitInfoFrom(src: UnitSource): LineUnits {
  return {
    satuan: src.satuan ?? null,
    satuan_besar_nama: src.satuan_besar_nama ?? src.satuan ?? null,
    satuan_kecil_nama: src.satuan_kecil_nama ?? null,
    konversi_factor: src.konversi_factor ?? null,
  };
}

/** Sesi lanjutan: qty terhitung dari server ditampilkan di satuan pilihan. */
export function linesFromDetail(
  lines: StockOpnameLine[],
  unitMode: RawMaterialUnitMode,
): CountLine[] {
  return lines.map((line) => {
    const units = unitInfoFrom(line);
    const mode = modeFor(units, unitMode);
    return {
      key: line.id,
      lineId: line.id,
      raw_material_id: line.raw_material_id,
      material_kode: line.material_kode || "",
      material_nama: line.material_nama || "",
      ...units,
      input_unit_mode: mode,
      qty_system: line.qty_system,
      qty_counted_input: displayQtyInputFromBase(line.qty_counted, mode, units),
    };
  });
}

/** Sesi baru: semua bahan stall, qty fisik masih kosong. */
export function linesFromPreview(
  items: StockOpnamePreviewLine[],
  unitMode: RawMaterialUnitMode,
): CountLine[] {
  return items.map((item) => {
    const units = unitInfoFrom(item);
    return {
      key: item.raw_material_id,
      raw_material_id: item.raw_material_id,
      material_kode: item.material_kode,
      material_nama: item.material_nama,
      ...units,
      input_unit_mode: modeFor(units, unitMode),
      qty_system: item.qty_system,
      qty_counted_input: "",
    };
  });
}

/** Ganti satuan satu baris; input yang sudah diisi ikut dikonversi. */
export function withUnitMode(
  line: CountLine,
  next: RawMaterialUnitMode,
): CountLine {
  if (line.input_unit_mode === next) return line;
  return {
    ...line,
    input_unit_mode: next,
    qty_counted_input: convertQtyInputBetweenModes(
      line.qty_counted_input,
      line.input_unit_mode,
      next,
      lineUnitInfo(line),
    ),
  };
}

export function withSystemQty(line: CountLine): CountLine {
  return {
    ...line,
    qty_counted_input: displayQtyInputFromBase(
      line.qty_system,
      line.input_unit_mode,
      lineUnitInfo(line),
    ),
  };
}

export function resolveBaseQty(line: CountLine): number | null {
  return baseQtyFromInput(
    line.qty_counted_input,
    line.input_unit_mode,
    lineUnitInfo(line),
  );
}

export function countProgress(lines: CountLine[]) {
  const counted = lines.filter((line) => line.qty_counted_input !== "");
  const variance = counted.filter((line) => {
    const base = resolveBaseQty(line);
    return base !== null && base !== line.qty_system;
  }).length;
  return { counted: counted.length, variance, total: lines.length };
}

/** Pesan galat input qty, atau null bila valid. `requireAll` untuk menyelesaikan opname. */
export function qtyInputError(
  lines: CountLine[],
  requireAll: boolean,
): string | null {
  if (requireAll) {
    const uncounted = lines.filter(
      (line) => line.qty_counted_input === "",
    ).length;
    if (uncounted > 0) return `${uncounted} baris belum dihitung`;
  }
  const invalid = lines.some((line) => {
    if (line.qty_counted_input === "") return false;
    const n = Number(line.qty_counted_input);
    return !Number.isFinite(n) || n < 0;
  });
  return invalid
    ? "Qty fisik harus berupa angka lebih besar atau sama dengan nol"
    : null;
}

/** Baris terhitung → update server, memetakan bahan ke id baris sesi yang baru dibuat. */
export function countedLineUpdates(
  lines: CountLine[],
  records: { id: string; raw_material_id: string }[],
) {
  const byMaterial = new Map(records.map((r) => [r.raw_material_id, r.id]));
  return lines
    .filter((line) => line.qty_counted_input !== "")
    .map((line) => ({
      id: line.lineId || byMaterial.get(line.raw_material_id) || "",
      qty_counted: resolveBaseQty(line) ?? 0,
    }))
    .filter((line) => line.id);
}

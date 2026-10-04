export type RawMaterialUnitMode = "besar" | "kecil";

export interface RawMaterialUnitInfo {
  satuan?: string | null;
  satuan_besar_nama?: string | null;
  satuan_kecil_nama?: string | null;
  konversi_factor?: number | null;
}

export function hasSmallUnit(info: RawMaterialUnitInfo): boolean {
  const factor = Number(info.konversi_factor) || 0;
  return Boolean(info.satuan_kecil_nama) && factor > 0;
}

export function getKonversiFactor(info: RawMaterialUnitInfo): number {
  return Number(info.konversi_factor) || 0;
}

export function getUnitLabel(info: RawMaterialUnitInfo, mode: RawMaterialUnitMode): string {
  const besar = info.satuan_besar_nama || info.satuan || "—";
  if (mode === "kecil" && hasSmallUnit(info)) {
    return info.satuan_kecil_nama as string;
  }
  return besar;
}

/** Qty di DB (satuan besar) → tampilan sesuai mode. */
export function toDisplayQty(
  baseQty: number,
  mode: RawMaterialUnitMode,
  info: RawMaterialUnitInfo
): number {
  if (mode === "kecil" && hasSmallUnit(info)) {
    return baseQty * getKonversiFactor(info);
  }
  return baseQty;
}

/** Input user (mode aktif) → satuan besar untuk simpan ke DB. */
export function toBaseQty(
  displayQty: number,
  mode: RawMaterialUnitMode,
  info: RawMaterialUnitInfo
): number {
  if (mode === "kecil" && hasSmallUnit(info)) {
    return displayQty / getKonversiFactor(info);
  }
  return displayQty;
}

export function convertQtyInputBetweenModes(
  input: string,
  from: RawMaterialUnitMode,
  to: RawMaterialUnitMode,
  info: RawMaterialUnitInfo
): string {
  if (!input.trim() || from === to || !hasSmallUnit(info)) return input;
  const n = Number(input);
  if (!Number.isFinite(n)) return input;
  const factor = getKonversiFactor(info);
  if (from === "besar" && to === "kecil") return String(n * factor);
  if (from === "kecil" && to === "besar") return String(n / factor);
  return input;
}

export function baseQtyFromInput(
  input: string,
  mode: RawMaterialUnitMode,
  info: RawMaterialUnitInfo
): number | null {
  if (input.trim() === "") return null;
  const n = Number(input);
  if (!Number.isFinite(n) || n < 0) return null;
  return toBaseQty(n, mode, info);
}

export function displayQtyInputFromBase(
  baseQty: number | null | undefined,
  mode: RawMaterialUnitMode,
  info: RawMaterialUnitInfo
): string {
  if (baseQty === null || baseQty === undefined) return "";
  return String(toDisplayQty(baseQty, mode, info));
}

export function formatUnitPairLabel(info: RawMaterialUnitInfo): string {
  const besar = info.satuan_besar_nama || info.satuan || "—";
  if (!hasSmallUnit(info)) return besar;
  return `${besar} / ${info.satuan_kecil_nama}`;
}

export function getItemUnitModeOptions(
  info: RawMaterialUnitInfo
): { value: RawMaterialUnitMode; label: string }[] {
  const besar = info.satuan_besar_nama || info.satuan || "Besar";
  const options: { value: RawMaterialUnitMode; label: string }[] = [
    { value: "besar", label: besar },
  ];
  if (hasSmallUnit(info)) {
    options.push({ value: "kecil", label: info.satuan_kecil_nama as string });
  }
  return options;
}

export const RAW_MATERIAL_UNIT_OPTIONS = [
  { value: "besar", label: "Satuan Besar" },
  { value: "kecil", label: "Satuan Kecil" },
] as const;

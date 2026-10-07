/**
 * Impor satuan (POST /api/purchasing/import/units): kode yang sudah dipakai di
 * company user dilewati. Satuan hanya menyimpan kode, nama, tipe dan deskripsi;
 * faktor konversi disimpan per bahan baku (raw_materials.konversi_factor dan
 * raw_material_unit_conversions), jadi kolom faktor_konversi dan satuan_induk
 * di file diabaikan.
 */
import { effectiveCompanyId, type UserScope } from "@/lib/api/scope";
import type { DbClient } from "@/lib/pg/types";
import { emptyToNull, ImportTally, type ImportRow } from "@/lib/purchasing/import-spreadsheet";
import { unitCodeTaken } from "@/lib/purchasing/unit-api";

const UNIT_TYPES = new Set(["BESAR", "KECIL", "KONVERSI"]);

/** Kolom units dari satu baris; string berarti tipe tidak valid. */
export function buildUnitPayload(data: Record<string, string>, companyId: string | null) {
  const tipe = (data.tipe ?? "").trim().toUpperCase();
  if (!UNIT_TYPES.has(tipe)) return "Tipe satuan harus BESAR, KECIL atau KONVERSI";
  return {
    kode: data.kode.trim(),
    nama: data.nama.trim(),
    tipe,
    deskripsi: emptyToNull(data.deskripsi),
    is_active: data.status?.toLowerCase() === "active",
    company_id: companyId,
  };
}

export async function importUnits(db: DbClient, rows: ImportRow[], scope: UserScope | null) {
  const companyId = effectiveCompanyId(scope);
  const tally = new ImportTally();

  for (const { rowNumber, data } of rows) {
    const missing = ["kode", "nama"].filter((field) => !data[field]?.trim());
    if (missing.length > 0) {
      tally.skip(rowNumber, `Field wajib kosong: ${missing.join(", ")}`);
      continue;
    }
    const payload = buildUnitPayload(data, companyId);
    if (typeof payload === "string") {
      tally.skip(rowNumber, payload);
      continue;
    }
    if (await unitCodeTaken(db, payload.kode, companyId)) {
      tally.skip(rowNumber, `Kode satuan ${payload.kode} sudah ada`);
      continue;
    }
    const { error } = await db.from("units").insert(payload);
    if (error) tally.skip(rowNumber, error.message);
    else tally.imported += 1;
  }

  return { success: true, imported: tally.imported, skipped: tally.skipped, errors: tally.errors };
}

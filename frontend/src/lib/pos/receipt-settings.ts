/**
 * Konfigurasi header/footer struk POS (EPIC-040).
 *
 * Baris disimpan sebagai array string di pos.pos_receipt_settings, per scope:
 * warehouse → branch → global. Default = array kosong, yang berarti struk
 * tampil persis seperti sebelum fitur ini ada — regresi nol untuk venue yang
 * belum mengonfigurasi apa pun.
 */

/** Lebar kertas thermal 80mm ≈ 42 kolom monospace. */
export const RECEIPT_LINE_MAX_CHARS = 42;
/** Batas wajar baris per bagian supaya struk tidak memanjang tak terkendali. */
export const RECEIPT_MAX_LINES_PER_SECTION = 6;

export const RECEIPT_SETTINGS_GLOBAL_ID = "b0000000-0000-4000-8000-000000000040";

export type PosReceiptSettings = {
  id: string | null;
  branch_id: string | null;
  warehouse_id: string | null;
  header_lines: string[];
  footer_lines: string[];
  show_stall_name: boolean;
  updated_at?: string | null;
};

export const DEFAULT_POS_RECEIPT_SETTINGS: PosReceiptSettings = {
  id: null,
  branch_id: null,
  warehouse_id: null,
  header_lines: [],
  footer_lines: [],
  show_stall_name: true,
};

/**
 * Rapikan input baris: buang non-string, trim, buang baris kosong, batasi
 * jumlah baris dan panjang per baris (kertas 80mm). Dipakai server (sanitasi
 * PUT) dan loader (data lama tetap aman dirender).
 */
export function normalizeReceiptLines(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((line): line is string => typeof line === "string")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, RECEIPT_MAX_LINES_PER_SECTION)
    .map((line) => line.slice(0, RECEIPT_LINE_MAX_CHARS));
}

export function normalizeReceiptSettings(
  row: Record<string, unknown> | null | undefined
): PosReceiptSettings {
  if (!row) return { ...DEFAULT_POS_RECEIPT_SETTINGS };
  return {
    id: typeof row.id === "string" ? row.id : null,
    branch_id: typeof row.branch_id === "string" ? row.branch_id : null,
    warehouse_id: typeof row.warehouse_id === "string" ? row.warehouse_id : null,
    header_lines: normalizeReceiptLines(row.header_lines),
    footer_lines: normalizeReceiptLines(row.footer_lines),
    show_stall_name: row.show_stall_name !== false,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : null,
  };
}

/**
 * Pilih baris paling spesifik untuk scope aktif: warehouse → branch → global.
 * Menerima seluruh baris aktif (hasil satu query) supaya resolusi murni dan
 * gampang di-unit-test.
 */
export function resolveReceiptSettings(
  rows: Array<Record<string, unknown>>,
  scope: { warehouseId?: string | null; branchId?: string | null }
): PosReceiptSettings {
  const normalized = rows.map(normalizeReceiptSettings);
  if (scope.warehouseId) {
    const match = normalized.find((row) => row.warehouse_id === scope.warehouseId);
    if (match) return match;
  }
  if (scope.branchId) {
    const match = normalized.find(
      (row) => row.branch_id === scope.branchId && !row.warehouse_id
    );
    if (match) return match;
  }
  return (
    normalized.find((row) => !row.branch_id && !row.warehouse_id) ?? {
      ...DEFAULT_POS_RECEIPT_SETTINGS,
    }
  );
}

type ReceiptSettingsQueryResult = PromiseLike<{
  data: unknown;
  error: { code?: string; message?: string } | null;
}>;

/** Loader semua baris aktif via shim PostgREST (pola loadPosLoyaltySettings). */
export async function loadPosReceiptSettingsRows(db: {
  from: (table: string) => {
    select: (columns: string) => { eq: (column: string, value: unknown) => ReceiptSettingsQueryResult };
  };
}): Promise<Array<Record<string, unknown>>> {
  try {
    const { data, error } = await db
      .from("pos_receipt_settings")
      .select("*")
      .eq("is_active", true);
    if (error) {
      if (error.code === "42P01" || /does not exist/i.test(String(error.message || ""))) {
        return [];
      }
      throw error;
    }
    return (data as Array<Record<string, unknown>>) ?? [];
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "42P01"
    ) {
      return [];
    }
    throw error;
  }
}

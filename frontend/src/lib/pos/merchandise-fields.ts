// EPIC-039 Fase A — normalisasi field merchandise pada payload produk POS.
// Dipakai POST /api/pos/products dan PATCH /api/pos/products/[id].

export const PRODUCT_KINDS = ["regular", "gift_card", "merchandise"] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

export type MerchandiseFieldsPayload = {
  product_kind?: string;
  source_product_id?: string | null;
  inventory_tracking?: boolean;
  inventory_quantity?: number | string;
  weight_gram?: number | string | null;
  length_cm?: number | string | null;
  width_cm?: number | string | null;
  height_cm?: number | string | null;
  long_description?: string | null;
};

export function normalizeProductKind(value?: string): ProductKind | null {
  const kind = String(value || "").trim().toLowerCase();
  return (PRODUCT_KINDS as readonly string[]).includes(kind)
    ? (kind as ProductKind)
    : null;
}

function toNullableNumber(value: number | string | null | undefined): number | null {
  if (value === undefined || value === null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

/**
 * Bangun kolom-kolom merchandise dari payload; hanya field yang DIKIRIM yang
 * masuk hasil (aman untuk PATCH parsial). `product_kind` tidak valid → error
 * string supaya caller bisa menolak 400, bukan diam-diam jadi 'regular'.
 */
export function buildMerchandiseColumns(body: MerchandiseFieldsPayload):
  | { ok: true; columns: Record<string, number | string | boolean | null> }
  | { ok: false; error: string } {
  const columns: Record<string, number | string | boolean | null> = {};

  if (body.product_kind !== undefined) {
    const kind = normalizeProductKind(body.product_kind);
    if (!kind) {
      return { ok: false, error: "product_kind tidak valid (regular|gift_card|merchandise)" };
    }
    columns.product_kind = kind;
    // Merchandise ber-stok flat: tracking default menyala kecuali dimatikan eksplisit
    if (kind === "merchandise" && body.inventory_tracking === undefined) {
      columns.inventory_tracking = true;
    }
  }

  if (body.source_product_id !== undefined) {
    columns.source_product_id = body.source_product_id
      ? String(body.source_product_id)
      : null;
  }
  if (body.inventory_tracking !== undefined) {
    columns.inventory_tracking = Boolean(body.inventory_tracking);
  }
  if (body.inventory_quantity !== undefined) {
    columns.inventory_quantity = toNullableNumber(body.inventory_quantity) ?? 0;
  }
  if (body.weight_gram !== undefined) {
    columns.weight_gram = toNullableNumber(body.weight_gram);
  }
  if (body.length_cm !== undefined) {
    columns.length_cm = toNullableNumber(body.length_cm);
  }
  if (body.width_cm !== undefined) {
    columns.width_cm = toNullableNumber(body.width_cm);
  }
  if (body.height_cm !== undefined) {
    columns.height_cm = toNullableNumber(body.height_cm);
  }
  if (body.long_description !== undefined) {
    columns.long_description = body.long_description
      ? String(body.long_description)
      : null;
  }

  return { ok: true, columns };
}

import type { ProductionMaterial } from "./production-ui-types";

/** Angka dari kolom numeric pg (sering string); selain angka valid menjadi 0. */
export function toNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

/** Nama item tanpa akhiran timestamp (mis. "Saus Tomat 1712345678901" dari impor lama). */
export function displayName(value?: string | null): string {
  return (value || "-").replace(/\s+\d{8,}$/g, "").trim();
}

export const PRODUCTION_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draf",
  RELEASED: "Dirilis",
  IN_PROGRESS: "Dalam Proses",
  COMPLETED: "Selesai",
  CANCELLED: "Dibatalkan",
};

export function productionStatusLabel(status: string): string {
  return PRODUCTION_STATUS_LABELS[status] || status;
}

export function productionStatusClass(status: string): string {
  if (status === "COMPLETED") return "border-emerald-200/80 bg-emerald-50 text-emerald-700";
  if (status === "IN_PROGRESS") return "border-sky-200/80 bg-sky-50 text-sky-700";
  if (status === "RELEASED") return "border-amber-200/80 bg-amber-50 text-amber-700";
  if (status === "CANCELLED") return "border-gray-200/80 bg-gray-50 text-gray-500";
  return "border-pink-200/80 bg-pink-50 text-pink-700";
}

const ACTIVE_STATUSES = ["DRAFT", "RELEASED", "IN_PROGRESS"];

/** Order yang masih berjalan (belum selesai/batal). */
export function isActiveProductionStatus(status: string): boolean {
  return ACTIVE_STATUSES.includes(status);
}

/** Item siap diproduksi bila resepnya punya minimal satu komponen. */
export function hasRecipe(item: { total_bahan_baku?: number | string | null }): boolean {
  return toNumber(item.total_bahan_baku) > 0;
}

/** Cocokkan kata kunci (huruf kecil) ke nama, kode, atau kategori item. */
export function matchesItemKeyword(
  item: { nama?: string | null; kode?: string | null; kategori?: string | null },
  keyword: string
): boolean {
  if (!keyword) return true;
  return [item.nama, item.kode, item.kategori]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(keyword));
}

export function paginate<T>(items: T[], page: number, pageSize: number) {
  return {
    rows: items.slice((page - 1) * pageSize, page * pageSize),
    totalPages: Math.max(1, Math.ceil(items.length / pageSize)),
  };
}

/** "Merah / XL" dari opsi varian SKU. */
export function optionsLabel(options?: Record<string, string> | null): string {
  if (!options) return "";
  return Object.values(options).filter(Boolean).join(" / ");
}

/**
 * Link form PO baru yang sudah terisi bahan yang kurang stok. Qty dibulatkan
 * ke atas karena PO tidak menerima pecahan satuan.
 */
export function shortagePoHref(
  poInsertRoute: string,
  order: { id: string; nomor_produksi: string },
  materials: ProductionMaterial[]
): string {
  const items = materials.map((material) => ({
    id: material.raw_material_id,
    kode: material.raw_material?.kode || "",
    nama: displayName(material.raw_material?.nama),
    qty: Math.ceil(toNumber(material.stock?.shortage_qty)),
    unit: material.satuan?.nama || "unit",
    price: toNumber(material.unit_cost),
  }));
  return (
    `${poInsertRoute}?source=production&production_order_id=${order.id}` +
    `&production_order=${encodeURIComponent(order.nomor_produksi)}` +
    `&items=${encodeURIComponent(JSON.stringify(items))}`
  );
}

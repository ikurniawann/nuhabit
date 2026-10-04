import { resolvePosStation } from "@/lib/pos/kitchen-station";
import type { BOMItem, ProductFormData, ProductWithCOGS, RawMaterialWithStock } from "@/types/purchasing";

export const EMPTY_PRODUCT_FORM: ProductFormData = {
  nama: "",
  kategori: "",
  satuan_id: "",
  warehouse_id: "",
  deskripsi: "",
  harga_jual: 0,
  is_active: true,
  production_output_type: "FINISHED_GOOD",
  station: "kitchen",
};

/** Isi form ubah produk; numeric pg sering datang sebagai string, jadi dipaksa ke number. */
export function productFormFromProduct(product: ProductWithCOGS): ProductFormData {
  return {
    nama: product.nama || "",
    kategori: product.kategori || "",
    satuan_id: product.satuan_id || product.unit_id || "",
    warehouse_id: product.warehouse_id || "",
    deskripsi: product.deskripsi || "",
    harga_jual: Number(product.harga_jual) || 0,
    is_active: product.is_active ?? true,
    production_output_type: product.production_output_type === "WIP" ? "WIP" : "FINISHED_GOOD",
    station: resolvePosStation(product.station, product.kategori),
  };
}

/** Markup (%) dari HPP ke harga jual, dua desimal; 0 bila HPP belum ada. */
export function calculateMarkupFromPrice(hpp: number, price: number): number {
  if (hpp <= 0) return 0;
  return Number((((price - hpp) / hpp) * 100).toFixed(2));
}

/**
 * Harga acuan (avg_cost/harga_beli) tersimpan per satuan BESAR, sedangkan qty BOM dalam
 * satuan KECIL, jadi biaya dinormalisasi ke satuan kecil (÷ konversi_factor).
 */
export function materialUnitCost(material?: RawMaterialWithStock): number {
  const baseCost = Number(material?.avg_cost ?? material?.harga_avg ?? material?.harga_terakhir ?? 0) || 0;
  const hasSmallUnit = Boolean(material?.satuan_kecil_nama || material?.satuan_kecil_id);
  const factor = Number(material?.konversi_factor ?? 0) || 0;
  return hasSmallUnit && factor > 0 ? baseCost / factor : baseCost;
}

/** Biaya satu baris BOM termasuk susut (persen). */
export function bomLineCost(material: RawMaterialWithStock | undefined, qty: number, wastePercent: number): number {
  return materialUnitCost(material) * qty * (1 + wastePercent / 100);
}

export function getBomQty(item: Partial<BOMItem>): number {
  return item.qty_needed ?? item.qty_required ?? item.qty ?? 0;
}

export function getBomWastePercent(item: Partial<BOMItem>): number {
  if (item.waste_persen !== undefined && item.waste_persen !== null) return item.waste_persen;
  return (item.waste_factor ?? 0) * 100;
}

export function materialSmallUnitLabel(material?: RawMaterialWithStock, fallback = "Satuan"): string {
  return material?.satuan_kecil_nama || material?.satuan || fallback;
}

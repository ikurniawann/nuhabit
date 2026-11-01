/**
 * Urai resep (Go GET /api/production/bom/explode): kebutuhan bahan bertingkat
 * untuk sejumlah unit produk atau bahan olahan. Jumlah dalam satuan stok.
 */

export type BomNode = {
  raw_material_id: string;
  kode: string;
  nama: string;
  satuan: string;
  level: number;
  qty_per_parent: number;
  recipe_qty_per: number;
  recipe_satuan: string;
  unit_factor: number;
  waste_factor: number;
  qty_required: number;
  qty_onhand: number;
  shortage_qty: number;
  unit_cost: number;
  total_cost: number;
  /** Biaya membuat satu unit dari komponennya; null untuk bahan beli. */
  rolled_unit_cost: number | null;
  has_recipe: boolean;
  children: BomNode[] | null;
};

/** Bahan beli untuk seluruh pohon, setelah dikurangi stok bahan setengah jadi. */
export type BomLeaf = {
  raw_material_id: string;
  kode: string;
  nama: string;
  satuan: string;
  qty_required: number;
  qty_onhand: number;
  shortage_qty: number;
  unit_cost: number;
  total_cost: number;
};

export type BomExplosion = {
  item: { id: string; kode: string; nama: string; satuan: string; type: "product" | "raw_material" };
  qty: number;
  lines: BomNode[];
  leaves: BomLeaf[] | null;
  /** Baris tingkat pertama dinilai dengan biaya rata-rata stok. */
  stock_cost: number;
  /** Bahan setengah jadi dinilai dengan biaya membuatnya. */
  rolled_cost: number;
  depth: number;
};

export type BomTreeRow = BomNode & { key: string };

/** Pohon resep menjadi baris tabel berurutan (induk lalu komponennya), kunci unik per jalur. */
export function flattenBomTree(lines: BomNode[], parentKey = ""): BomTreeRow[] {
  return lines.flatMap((node, index) => {
    const key = `${parentKey}${index}-${node.raw_material_id}`;
    return [{ ...node, key }, ...flattenBomTree(node.children ?? [], `${key}/`)];
  });
}

/** Qty yang diisi pengguna; selain angka positif dibaca sebagai null. */
export function parseExplodeQty(raw: string): number | null {
  const qty = Number(raw.replace(",", "."));
  return raw.trim() !== "" && Number.isFinite(qty) && qty > 0 ? qty : null;
}

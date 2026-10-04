export type RecipeProduct = {
  id: string;
  nama?: string | null;
  name?: string | null;
  kode?: string | null;
  harga_jual?: number | string | null;
  hpp_estimasi?: number | string | null;
  estimated_cogs?: number | string | null;
};

export type RecipeRawMaterial = {
  id: string;
  nama?: string | null;
  name?: string | null;
  kode?: string | null;
  satuan_besar_nama?: string | null;
  satuan?: string | null;
  avg_cost?: number | string | null;
  qty_onhand?: number | string | null;
};

export type BomRow = {
  id?: string;
  raw_material_id: string;
  name: string;
  unit: string;
  quantity: number;
  wasteFactor: number;
  costPerUnit: number;
};

export type BomApiRow = {
  id?: string;
  raw_material_id: string;
  qty_required?: number | string | null;
  waste_factor?: number | string | null;
  cost_per_unit?: number | string | null;
  raw_material?: {
    nama?: string | null;
    name?: string | null;
    satuan?: string | null;
    avg_cost?: number | string | null;
    satuan_besar?: { nama?: string | null } | null;
  } | null;
  satuan?: { nama?: string | null } | null;
};

export type SaveBomItemPayload = {
  raw_material_id: string;
  qty_required: number;
  waste_factor: number;
};

export type RecipeCatalogBundle = {
  products: RecipeProduct[];
  materials: RecipeRawMaterial[];
};

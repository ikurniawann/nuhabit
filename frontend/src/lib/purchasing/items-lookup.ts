import { z } from "zod";

export const ITEMS_LOOKUP_TYPES = [
  "raw-material-categories",
  "product-categories",
  // EPIC-026: kategori barang operasional (scope 'general')
  "supply-categories",
] as const;

export type ItemsLookupType = (typeof ITEMS_LOOKUP_TYPES)[number];

export interface ItemsLookupConfig {
  table: string;
  title: string;
  description: string;
}

export const ITEMS_LOOKUP_CONFIG: Record<ItemsLookupType, ItemsLookupConfig> = {
  "raw-material-categories": {
    table: "raw_material_categories",
    title: "Kategori Bahan Baku",
    description: "Kelola kategori bahan baku",
  },
  "product-categories": {
    table: "product_categories",
    title: "Product Categories",
    description: "Manage categories for finished products",
  },
  "supply-categories": {
    table: "supply_categories",
    title: "Kategori Barang Operasional",
    description: "Kelola kategori barang operasional (ATK, spare part, dll)",
  },
};

export const itemsLookupSchema = z.object({
  code: z.string().min(1, "Kode wajib diisi").max(30),
  nama: z.string().min(1, "Nama wajib diisi").max(100),
  deskripsi: z.string().optional().nullable(),
  is_active: z.boolean().optional(),
});

export type ItemsLookupFormData = z.infer<typeof itemsLookupSchema>;

export interface ItemsLookupRecord {
  id: string;
  code: string;
  nama: string;
  deskripsi: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export function isItemsLookupType(value: string): value is ItemsLookupType {
  return ITEMS_LOOKUP_TYPES.includes(value as ItemsLookupType);
}

export function getItemsLookupConfig(type: string): ItemsLookupConfig | null {
  if (!isItemsLookupType(type)) return null;
  return ITEMS_LOOKUP_CONFIG[type];
}

export type VendorCategory =
  | "it"
  | "office"
  | "stationery"
  | "services"
  | "raw_material"
  | "other";

/**
 * Peruntukan vendor — menentukan di modul PO mana vendor muncul.
 * 'fnb' = hanya PO produk/F&B; 'operasional' = hanya PO barang operasional;
 * 'keduanya' = muncul di kedua modul.
 */
export type VendorUsageScope = "fnb" | "operasional" | "keduanya";

export interface Vendor {
  id: string;
  code: string;
  name: string;
  contact_person: string;
  phone: string;
  email: string;
  address: string;
  category: VendorCategory;
  usage_scope: VendorUsageScope;
  npwp?: string | null;
  bank_name?: string | null;
  bank_account?: string | null;
  bank_account_name?: string | null;
  is_active: boolean;
  notes?: string | null;
  created_at?: string;
  company_id?: string | null;
  branch_id?: string | null;
}

export interface VendorFormData {
  name: string;
  contact_person: string;
  phone: string;
  email: string;
  address: string;
  category: VendorCategory;
  usage_scope: VendorUsageScope;
  npwp?: string;
  bank_name?: string;
  bank_account?: string;
  bank_account_name?: string;
  notes?: string;
}

export interface VendorListParams {
  search?: string;
  category?: VendorCategory | "all";
  usage_scope?: VendorUsageScope | "all";
  status?: "all" | "active" | "inactive";
  page?: number;
  limit?: number;
}

export const VENDOR_CATEGORY_OPTIONS: { value: VendorCategory; label: string }[] = [
  { value: "it", label: "IT" },
  { value: "office", label: "Office" },
  { value: "stationery", label: "Stationery" },
  { value: "services", label: "Services" },
  { value: "raw_material", label: "Raw Material" },
  { value: "other", label: "Other" },
];

export function getVendorCategoryLabel(category?: VendorCategory | string | null) {
  return VENDOR_CATEGORY_OPTIONS.find((row) => row.value === category)?.label ?? category ?? "-";
}

export const VENDOR_USAGE_OPTIONS: { value: VendorUsageScope; label: string }[] = [
  { value: "fnb", label: "Produk / F&B" },
  { value: "operasional", label: "Barang Operasional" },
  { value: "keduanya", label: "Keduanya" },
];

export function getVendorUsageLabel(usage?: VendorUsageScope | string | null) {
  return VENDOR_USAGE_OPTIONS.find((row) => row.value === usage)?.label ?? usage ?? "-";
}

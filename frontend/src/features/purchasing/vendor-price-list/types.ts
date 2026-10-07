export type VendorPriceListVendor = {
  id: string;
  code: string;
  name: string;
  contact_person?: string;
  phone?: string;
  email?: string;
};

export type VendorPriceListProduct = {
  id: string;
  kode: string;
  nama: string;
  satuan_id?: string | null;
};

export type VendorPriceListUnit = {
  id: string;
  kode?: string;
  nama: string;
};

export type VendorPriceList = {
  id: string;
  vendor_id: string;
  product_id: string;
  harga: number;
  satuan_id?: string | null;
  minimum_qty: number;
  lead_time_days: number;
  is_preferred: boolean;
  is_active: boolean;
  berlaku_dari: string;
  berlaku_sampai?: string | null;
  catatan?: string | null;
  created_at?: string;
  updated_at?: string;
  vendor?: VendorPriceListVendor | null;
  product?: VendorPriceListProduct | null;
  unit?: VendorPriceListUnit | null;
};

export type VendorPriceListFormData = {
  vendor_id: string;
  product_id: string;
  harga: number;
  satuan_id?: string;
  minimum_qty: number;
  lead_time_days: number;
  is_preferred: boolean;
  berlaku_dari?: string;
  berlaku_sampai?: string;
  catatan?: string;
};

export type VendorPriceListListParams = {
  search?: string;
  vendor_id?: string;
  product_id?: string;
  status?: "all" | "active" | "inactive";
  page?: number;
  limit?: number;
};

export type VendorOption = {
  id: string;
  code: string;
  name: string;
};

export type ProductOption = {
  id: string;
  kode: string;
  nama: string;
  satuan_id?: string | null;
  satuan_nama?: string | null;
};

export type UnitOption = {
  id: string;
  kode?: string;
  nama: string;
  simbol?: string;
};

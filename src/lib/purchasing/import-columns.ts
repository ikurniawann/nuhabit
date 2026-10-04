import { CURRENCY_OPTIONS, PAYMENT_TERMS_OPTIONS } from "@/types/supplier";

/** Master category codes — must exist in raw material categories (see items-raw-material-categories seeder). */
export const RAW_MATERIAL_IMPORT_CATEGORY_HINT =
  "SAYUR, DAGING, SEAFOOD, DAIRY, BUMBU, KERING, MINUMAN, SAUS, BAKERY, BEKU, OIL, PROTEIN, KEMASAN, NONPANG, BAKAR, LAIN";

export const RAW_MATERIAL_IMPORT_COLUMNS = [
  {
    key: "kode",
    label: "Kode",
    required: false,
    description: "Kosongkan untuk dibuat otomatis BHN-YYYY-####",
  },
  { key: "nama", label: "Nama", required: true },
  {
    key: "kategori",
    label: "Kode Kategori",
    required: true,
    description: RAW_MATERIAL_IMPORT_CATEGORY_HINT,
  },
  {
    key: "satuan_besar_kode",
    label: "Kode Satuan Besar",
    required: true,
    description: "Harus sesuai master satuan (mis. KG, SACK, DOS, TRAY)",
  },
  {
    key: "satuan_kecil_kode",
    label: "Kode Satuan Kecil",
    required: false,
    description: "Satuan dasar/stok (mis. GR, ML, PCS). Kosongkan jika sama dengan satuan besar.",
  },
  {
    key: "konversi_factor",
    label: "Faktor Konversi",
    required: false,
    type: "number" as const,
    description: "Jumlah satuan kecil per 1 satuan besar (mis. 1 SACK = 25 KG → 25)",
  },
  { key: "stok_minimum", label: "Stok Minimum", required: false, type: "number" as const },
  { key: "stok_maximum", label: "Stok Maksimum", required: false, type: "number" as const },
  {
    key: "shelf_life_days",
    label: "Masa Simpan (hari)",
    required: false,
    type: "number" as const,
    description: "Kosongkan jika tidak berlaku (kemasan, bahan bakar, dll.)",
  },
  { key: "coa", label: "COA", required: false, description: "PRODUCTION, RND, atau ASSET" },
  {
    key: "harga_beli",
    label: "Harga Beli",
    required: false,
    type: "number" as const,
    description: "Harga per satuan besar (IDR)",
  },
  {
    key: "opening_stock",
    label: "Stok Awal",
    required: false,
    type: "number" as const,
    description: "Jumlah awal dalam satuan kecil/dasar",
  },
  {
    key: "stall_code",
    label: "Kode Outlet",
    required: false,
    description: "WH-01 (Gudang Utama), STALL-02 … STALL-14",
  },
  { key: "deskripsi", label: "Deskripsi", required: false },
  { key: "status", label: "Status", required: false, description: "active atau inactive" },
];

export const SUPPLIER_IMPORT_COLUMNS = [
  {
    key: "kode",
    label: "Kode",
    required: false,
    description: "Kosongkan untuk membuat otomatis SUP-YYYY-####",
  },
  { key: "nama_supplier", label: "Nama Supplier", required: true },
  { key: "pic_name", label: "Narahubung", required: false },
  { key: "pic_phone", label: "Telepon Narahubung", required: false },
  { key: "pic_email", label: "Email Narahubung", required: false, type: "email" as const },
  { key: "telepon", label: "Telepon Perusahaan", required: false },
  { key: "email", label: "Email Perusahaan", required: false, type: "email" as const },
  { key: "alamat", label: "Alamat", required: false },
  { key: "kota", label: "Kota", required: false },
  { key: "npwp", label: "NPWP", required: false },
  {
    key: "payment_terms",
    label: "Termin Pembayaran",
    required: false,
    description: PAYMENT_TERMS_OPTIONS.join(", "),
  },
  {
    key: "currency",
    label: "Mata Uang",
    required: false,
    description: CURRENCY_OPTIONS.join(", "),
  },
  { key: "bank_nama", label: "Nama Bank", required: false },
  { key: "bank_rekening", label: "Nomor Rekening", required: false },
  { key: "bank_atas_nama", label: "Atas Nama", required: false },
  { key: "kategori", label: "Kategori", required: false },
  { key: "catatan", label: "Catatan", required: false },
  {
    key: "status",
    label: "Status",
    required: false,
    description: "active, inactive, probation, blocked, atau draft",
  },
];

export const PRODUCT_IMPORT_CATEGORY_HINT =
  "APPETIZER, MAIN, RICE, NOODLE, SOUP, SIDE, SNACK, DESSERT, COFFEE, TEA, BEVERAGE, JUICE, MOCKTAIL, BAKERY, CAKE, PACKAGE, PROMO, OTHER";

export const PRODUCT_IMPORT_COLUMNS = [
  {
    key: "kode",
    label: "Code",
    required: false,
    description: "Leave empty to auto-generate PRD-YYYYMMDD-###",
  },
  { key: "nama", label: "Product Name", required: true },
  {
    key: "stall_code",
    label: "Stall Code",
    required: true,
    description: "Must match stall master (e.g. MAIN, STALL-01)",
  },
  {
    key: "kategori",
    label: "Category Code",
    required: false,
    description: PRODUCT_IMPORT_CATEGORY_HINT,
  },
  {
    key: "satuan_kode",
    label: "Unit Code",
    required: true,
    description: "Must match unit master (e.g. PCS, PORTION, PORSI)",
  },
  { key: "deskripsi", label: "Description", required: false },
  {
    key: "harga_jual",
    label: "Selling Price",
    required: false,
    type: "number" as const,
  },
  {
    key: "harga_modal",
    label: "Cost Price",
    required: false,
    type: "number" as const,
  },
  {
    key: "markup_persen",
    label: "Markup %",
    required: false,
    type: "number" as const,
    description: "Default 30 when empty",
  },
  {
    key: "production_output_type",
    label: "Output Type",
    required: false,
    description: "FINISHED_GOOD or WIP",
  },
  {
    key: "status",
    label: "Status",
    required: false,
    description: "active or inactive",
  },
];

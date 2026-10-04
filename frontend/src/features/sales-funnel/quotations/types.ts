export type QuotationStatus = "draft" | "terkirim" | "diterima" | "ditolak" | "superseded";
export type QuotationItemType = "produk" | "bebas";

export interface QuotationItem {
  id: string;
  item_type: QuotationItemType;
  product_id: string | null;
  description: string;
  qty: string | number;
  unit_price: string | number;
  line_total: string | number;
}

export type BomStatus = "terpotong" | "tidak-terpotong";

/** Termin pembayaran (Fase G) — persen dari total, Σ = 100. */
export interface QuotationTerm {
  id: string;
  label: string;
  percent: string | number;
  due_date: string | null;
}

export interface Quotation {
  id: string;
  quote_number: string;
  status: QuotationStatus;
  use_ppn: boolean;
  ppn_persen: string | number;
  subtotal: string | number;
  discount_percent?: string | number;
  discount_nominal?: string | number;
  approval_status?: "none" | "pending" | "approved" | "rejected";
  approval_request_id?: string | null;
  version?: number;
  parent_quotation_id?: string | null;
  superseded_at?: string | null;
  ppn_nominal: string | number;
  total: string | number;
  notes: string | null;
  valid_until: string | null;
  stock_deducted_at: string | null;
  bom_status: BomStatus | null;
  created_at: string;
  items: QuotationItem[];
  terms: QuotationTerm[];
}

export interface StockShortage {
  raw_material_id: string;
  kode: string | null;
  nama: string;
  satuan: string | null;
  needed: number;
  available: number;
}

/** 409 realisasi: bawa detail kekurangan utk dialog "lanjut tanpa BOM". */
export class RealizeConflictError extends Error {
  constructor(
    message: string,
    public shortages: StockShortage[],
    public warnings: string[]
  ) {
    super(message);
    this.name = "RealizeConflictError";
  }
}

export interface CatalogProduct {
  id: string;
  name: string;
  base_price: string | number;
}

export interface QuotationItemForm {
  item_type: QuotationItemType;
  product_id: string;
  description: string;
  qty: string;
  unit_price: string;
}

export interface QuotationTermForm {
  label: string;
  percent: string;
  due_date: string;
}

export interface QuotationFormValues {
  use_ppn: boolean;
  ppn_persen: string;
  /** EPIC-050 Fase 2: diskon header (% subtotal) — > ambang butuh approval */
  discount_percent: string;
  notes: string;
  valid_until: string;
  items: QuotationItemForm[];
  /** Kosong = tanpa termin; terisi = Σ persen wajib 100. */
  terms: QuotationTermForm[];
}

export const QUOTATION_STATUS_LABELS: Record<QuotationStatus, string> = {
  draft: "Draft",
  terkirim: "Terkirim",
  diterima: "Diterima",
  ditolak: "Ditolak",
  superseded: "Digantikan",
};

export const QUOTATION_STATUS_BADGES: Record<QuotationStatus, string> = {
  draft: "border-0 bg-gray-100 font-normal text-gray-600",
  terkirim: "border-0 bg-blue-100 font-normal text-blue-700",
  diterima: "border-0 bg-emerald-100 font-normal text-emerald-700",
  ditolak: "border-0 bg-red-100 font-normal text-red-700",
  superseded: "border-0 bg-gray-100 font-normal text-gray-400 line-through",
};

export const EMPTY_ITEM_FORM: QuotationItemForm = {
  item_type: "bebas",
  product_id: "",
  description: "",
  qty: "1",
  unit_price: "",
};

export const EMPTY_TERM_FORM: QuotationTermForm = {
  label: "",
  percent: "",
  due_date: "",
};

/** Preset umum theme park/event: DP 50% + pelunasan 50%. */
export const DEFAULT_TERMS_PRESET: QuotationTermForm[] = [
  { label: "DP", percent: "50", due_date: "" },
  { label: "Pelunasan", percent: "50", due_date: "" },
];

export const EMPTY_QUOTATION_FORM: QuotationFormValues = {
  use_ppn: true,
  ppn_persen: "11",
  discount_percent: "0",
  notes: "",
  valid_until: "",
  items: [{ ...EMPTY_ITEM_FORM }],
  terms: [],
};

/** Σ persen termin form (2dp) — 0 bila tanpa termin. */
export function termPercentSum(terms: QuotationTermForm[]): number {
  return (
    Math.round(terms.reduce((sum, t) => sum + (Number(t.percent) || 0), 0) * 100) /
    100
  );
}

export function itemLineTotal(item: QuotationItemForm): number {
  const qty = Number(item.qty) || 0;
  const price = Number(item.unit_price) || 0;
  return Math.round(qty * price * 100) / 100;
}

export function formTotals(form: QuotationFormValues): {
  subtotal: number;
  discount: number;
  ppn: number;
  total: number;
} {
  const subtotal =
    Math.round(form.items.reduce((acc, item) => acc + itemLineTotal(item), 0) * 100) /
    100;
  const pct = Math.min(100, Math.max(0, Number(form.discount_percent) || 0));
  const discount = Math.round(subtotal * pct) / 100;
  const dpp = Math.round((subtotal - discount) * 100) / 100;
  const ppn = form.use_ppn
    ? Math.round(dpp * (Number(form.ppn_persen) || 0)) / 100
    : 0;
  return { subtotal, discount, ppn, total: Math.round((dpp + ppn) * 100) / 100 };
}

/** Payload API dari nilai form (angka dikonversi, baris kosong dibuang). */
export function formToPayload(form: QuotationFormValues) {
  return {
    use_ppn: form.use_ppn,
    ppn_persen: Number(form.ppn_persen) || 0,
    discount_percent: Math.min(100, Math.max(0, Number(form.discount_percent) || 0)),
    notes: form.notes || null,
    valid_until: form.valid_until || null,
    items: form.items
      .filter((item) => item.description.trim() && Number(item.qty) > 0)
      .map((item) => ({
        item_type: item.item_type,
        product_id: item.item_type === "produk" ? item.product_id || null : null,
        description: item.description.trim(),
        qty: Number(item.qty),
        unit_price: Number(item.unit_price) || 0,
      })),
    terms: form.terms
      .filter((term) => term.label.trim() && Number(term.percent) > 0)
      .map((term) => ({
        label: term.label.trim(),
        percent: Number(term.percent),
        due_date: term.due_date || null,
      })),
  };
}

export const APPROVAL_STATUS_LABELS: Record<NonNullable<Quotation["approval_status"]>, string> = {
  none: "",
  pending: "Menunggu approval diskon",
  approved: "Diskon disetujui",
  rejected: "Diskon ditolak",
};
export const APPROVAL_STATUS_BADGES: Record<NonNullable<Quotation["approval_status"]>, string> = {
  none: "",
  pending: "border-0 bg-amber-100 font-normal text-amber-700",
  approved: "border-0 bg-emerald-100 font-normal text-emerald-700",
  rejected: "border-0 bg-red-100 font-normal text-red-700",
};

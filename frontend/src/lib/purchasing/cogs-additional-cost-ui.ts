/*
 * Biaya tambahan pembelian di halaman COGS: konstanta dan aturan form yang
 * aman dipakai di client (tanpa akses database). Server memakai konstanta
 * yang sama di cogs-additional-cost.ts.
 */

export const ADDITIONAL_COST_REFERENCE_TYPES = ["PO", "GRN"] as const;
export type AdditionalCostReferenceType = (typeof ADDITIONAL_COST_REFERENCE_TYPES)[number];

export const ADDITIONAL_COST_TYPES = ["freight", "duty", "handling", "asuransi", "loading", "lainnya"] as const;
export type AdditionalCostType = (typeof ADDITIONAL_COST_TYPES)[number];

export const ADDITIONAL_COST_TYPE_LABELS: Record<AdditionalCostType, string> = {
  freight: "Freight / Ongkir",
  duty: "Bea Masuk",
  handling: "Handling",
  asuransi: "Asuransi",
  loading: "Bongkar Muat",
  lainnya: "Lainnya",
};

/** Baris daftar biaya tambahan seperti dikirim API (angka numeric berupa string). */
export interface AdditionalCost {
  id: string;
  reference_type: AdditionalCostReferenceType;
  reference_id: string;
  reference_number: string | null;
  tipe_biaya: AdditionalCostType;
  deskripsi: string | null;
  jumlah: string;
  currency: string;
  exchange_rate: string;
  jumlah_idr: string;
  tanggal_transaksi: string;
  catatan: string | null;
  created_at: string;
  created_by_name: string | null;
}

export interface AdditionalCostForm {
  reference_type: AdditionalCostReferenceType;
  reference_id: string;
  tipe_biaya: AdditionalCostType;
  jumlah: number | null;
  currency: string;
  exchange_rate: number | null;
  tanggal_transaksi: string;
  deskripsi: string;
}

export interface AdditionalCostPayload {
  reference_type: AdditionalCostReferenceType;
  reference_id: string;
  tipe_biaya: AdditionalCostType;
  jumlah: number;
  currency: string;
  exchange_rate: number;
  tanggal_transaksi: string;
  deskripsi?: string;
}

export function emptyAdditionalCostForm(today: string): AdditionalCostForm {
  return {
    reference_type: "GRN",
    reference_id: "",
    tipe_biaya: "freight",
    jumlah: null,
    currency: "IDR",
    exchange_rate: 1,
    tanggal_transaksi: today,
    deskripsi: "",
  };
}

/** Validasi form; mata uang IDR selalu kurs 1. */
export function buildAdditionalCostPayload(
  form: AdditionalCostForm
): { payload: AdditionalCostPayload } | { error: string } {
  if (!form.reference_id) return { error: `Pilih ${form.reference_type} terlebih dahulu` };
  if (!form.jumlah || form.jumlah <= 0) return { error: "Nominal harus lebih dari 0" };
  const currency = form.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { error: "Mata uang harus 3 huruf, mis. IDR atau USD" };
  const exchangeRate = currency === "IDR" ? 1 : form.exchange_rate ?? 0;
  if (exchangeRate <= 0) return { error: "Kurs ke Rupiah harus lebih dari 0" };
  const deskripsi = form.deskripsi.trim();
  return {
    payload: {
      reference_type: form.reference_type,
      reference_id: form.reference_id,
      tipe_biaya: form.tipe_biaya,
      jumlah: form.jumlah,
      currency,
      exchange_rate: exchangeRate,
      tanggal_transaksi: form.tanggal_transaksi,
      ...(deskripsi ? { deskripsi } : {}),
    },
  };
}

export function sumCostsIdr(rows: Pick<AdditionalCost, "jumlah_idr">[]) {
  return rows.reduce((sum, row) => sum + (Number(row.jumlah_idr) || 0), 0);
}

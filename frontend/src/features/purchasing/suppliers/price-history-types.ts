export interface PurchasePriceHistoryItem {
  id: string;
  supplier_id: string;
  nama_supplier: string;
  bahan_baku_id: string;
  bahan_baku_nama: string;
  /** Harga per satuan dasar bahan baku, diambil dari penerimaan GRN. */
  harga: number;
  qty: number;
  satuan_nama: string;
  tanggal: string;
  reference_number: string | null;
  previous_price: number | null;
  price_change_percent: number | null;
}

// EPIC-026 B4 — Penerimaan (GRN) barang operasional (scope 'general').
// Alur RAMPING: TANPA langkah delivery manual — penerimaan langsung dari PO,
// delivery dibuat otomatis di backend (grn/route.ts). TANPA QC & TANPA
// pergerakan stok riil di v1 (item hanya ditandai diterima).

import { apiErrorMessage } from "@/lib/purchasing/receiving-ui-http";
import type { GeneralGrnItemPayload } from "@/lib/purchasing/receiving-ui-general";
import { listGeneralPurchaseOrders } from "../general-po/api";

// Status PO yang masih bisa diterima (belum tuntas).
const RECEIVABLE_STATUSES = ["approved", "sent", "partially_received", "partial"];

export interface ReceivableGeneralPO {
  id: string;
  nomor_po: string;
  tanggal_po: string;
  vendor_name: string;
  status: string;
  total_items: number;
}

export async function listReceivableGeneralPOs(search?: string): Promise<ReceivableGeneralPO[]> {
  const result = await listGeneralPurchaseOrders({ page: 1, limit: 100, search: search || undefined });
  return result.data
    .filter((po) => RECEIVABLE_STATUSES.includes(String(po.status).toLowerCase()))
    .map((po) => ({
      id: po.id,
      nomor_po: po.nomor_po,
      tanggal_po: po.tanggal_po,
      vendor_name: po.vendor_name || "-",
      status: po.status,
      total_items: po.total_items ?? 0,
    }));
}

export interface CreateGeneralGrnPayload {
  po_id: string;
  warehouse_id: string;
  catatan?: string;
  items: GeneralGrnItemPayload[];
}

export async function createGeneralGrn(payload: CreateGeneralGrnPayload): Promise<{ id: string; nomor_grn?: string }> {
  const res = await fetch("/api/purchasing/grn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, module_type: "general" }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) {
    throw new Error(apiErrorMessage(json, "Gagal menyimpan penerimaan barang"));
  }
  return (json?.data ?? json) as { id: string; nomor_grn?: string };
}

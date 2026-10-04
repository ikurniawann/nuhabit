import type { DbClient } from "@/lib/pg/types";

export type PoFulfillmentProgress = {
  order_progress_pct: number;
  receipt_progress_pct: number;
  qc_progress_pct: number;
  return_progress_pct: number;
  fulfillment_progress_pct: number;
  total_qty_received_grn: number;
  total_qty_qc_posted: number;
  total_qty_returned: number;
};

function roundPct(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)) * 100) / 100;
}

function computeOrderProgress(status: string): number {
  const normalized = status.toLowerCase();
  if (normalized === "cancelled") return 0;
  if (normalized === "draft") return 0;
  if (normalized === "approved") return 50;
  return 100;
}

export async function computePoFulfillmentProgress(
  db: DbClient,
  poId: string,
  poStatus: string,
  receivingProgressPct: number
): Promise<PoFulfillmentProgress> {
  const order_progress_pct = computeOrderProgress(poStatus);
  const receipt_progress_pct = roundPct(Number(receivingProgressPct || 0));

  const { data: grnRows, error: grnError } = await db
    .from("grn")
    .select("id")
    .eq("purchase_order_id", poId)
    .eq("is_active", true);

  if (grnError) throw grnError;

  const grnIds = ((grnRows ?? []) as Array<{ id: string }>).map((row) => row.id);
  let total_qty_received_grn = 0;
  let total_qty_qc_posted = 0;
  let total_qty_returned = 0;

  if (grnIds.length > 0) {
    const { data: grnItems, error: itemsError } = await db
      .from("grn_items")
      .select("qty_diterima, qty_qc_posted, qty_returned")
      .in("grn_id", grnIds)
      .eq("is_active", true);

    if (itemsError) throw itemsError;

    for (const item of grnItems || []) {
      total_qty_received_grn += Number(item.qty_diterima || 0);
      total_qty_qc_posted += Number(item.qty_qc_posted || 0);
      total_qty_returned += Number(item.qty_returned || 0);
    }
  }

  const qc_progress_pct =
    total_qty_received_grn > 0
      ? roundPct((total_qty_qc_posted / total_qty_received_grn) * 100)
      : 0;

  const return_progress_pct =
    total_qty_qc_posted > 0
      ? roundPct((total_qty_returned / total_qty_qc_posted) * 100)
      : total_qty_returned > 0
        ? 100
        : 0;

  const fulfillment_progress_pct = roundPct(
    (order_progress_pct + receipt_progress_pct + qc_progress_pct + return_progress_pct) / 4
  );

  return {
    order_progress_pct,
    receipt_progress_pct,
    qc_progress_pct,
    return_progress_pct,
    fulfillment_progress_pct,
    total_qty_received_grn,
    total_qty_qc_posted,
    total_qty_returned,
  };
}

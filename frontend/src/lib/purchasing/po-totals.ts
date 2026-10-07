import type { DbClient } from "@/lib/pg/types";

type POTotalsInput = {
  diskon_persen?: number | null;
  diskon_nominal?: number | null;
  ppn_persen?: number | null;
};

export type PoTotals = {
  subtotal: number;
  diskon_nominal: number;
  ppn_nominal: number;
  total: number;
};

type PoTotalLine = { qty_ordered?: unknown; harga_satuan?: unknown; diskon_item?: unknown };

/** Σ (qty × harga − diskon item) baris aktif PO. */
export function sumPoLines(lines: PoTotalLine[]): number {
  return lines.reduce(
    (sum, line) =>
      sum +
      Number(line.qty_ordered || 0) * Number(line.harga_satuan || 0) -
      Number(line.diskon_item || 0),
    0
  );
}

/**
 * Diskon persen (> 0) mengalahkan diskon nominal; PPN dihitung dari DPP
 * (subtotal − diskon, minimal 0). PPN default 11%.
 */
export function computePoTotals(subtotal: number, input: POTotalsInput): PoTotals {
  const diskonPersen = Number(input.diskon_persen ?? 0);
  const diskonNominal =
    diskonPersen > 0 ? (subtotal * diskonPersen) / 100 : Number(input.diskon_nominal ?? 0);
  const taxableAmount = Math.max(0, subtotal - diskonNominal);
  const ppnNominal = (taxableAmount * Number(input.ppn_persen ?? 11)) / 100;
  return {
    subtotal,
    diskon_nominal: diskonNominal,
    ppn_nominal: ppnNominal,
    total: taxableAmount + ppnNominal,
  };
}

export async function recalculatePurchaseOrderTotals(
  db: DbClient,
  poId: string,
  overrides: POTotalsInput = {}
): Promise<PoTotals> {
  const { data: po, error: poError } = await db
    .from("purchase_orders")
    .select("diskon_persen,diskon_nominal,ppn_persen")
    .eq("id", poId)
    .single();

  if (poError || !po) throw poError || new Error("PO tidak ditemukan");

  const { data: items, error: itemsError } = await db
    .from("purchase_order_items")
    .select("qty_ordered,harga_satuan,diskon_item")
    .eq("purchase_order_id", poId)
    .eq("is_active", true);

  if (itemsError) throw itemsError;

  return computePoTotals(sumPoLines((items ?? []) as PoTotalLine[]), {
    diskon_persen: overrides.diskon_persen ?? po.diskon_persen,
    diskon_nominal: overrides.diskon_nominal ?? po.diskon_nominal,
    ppn_persen: overrides.ppn_persen ?? po.ppn_persen,
  });
}

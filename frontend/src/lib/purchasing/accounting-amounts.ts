import type { DbClient } from "@/lib/pg/types";
import { toQty } from "@/lib/purchasing/utils";
import type { JournalAmountMap } from "@/lib/accounting/journal-mapping-posting";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/**
 * Inventory / AP value for a GRN = Σ qty lolos QC × harga PO item.
 * Falls back to qty_diterima when qty_qc_posted is 0 (general receive).
 */
export async function buildGrnAccountingAmounts(
  db: DbClient,
  grnId: string
): Promise<{ amounts: JournalAmountMap; companyId: string | null; entryDate: string; nomorGrn: string }> {
  const { data: grn, error: grnError } = await db
    .from("grn")
    .select("id, nomor_grn, company_id, tanggal_penerimaan, purchase_order_id")
    .eq("id", grnId)
    .single();

  if (grnError || !grn) {
    throw new Error("GRN tidak ditemukan untuk posting accounting");
  }

  const { data: items, error: itemsError } = await db
    .from("grn_items")
    .select(
      `
      id,
      qty_diterima,
      qty_qc_posted,
      purchase_order_item_id,
      purchase_order_item:purchase_order_items!purchase_order_item_id(
        harga_satuan,
        qty_ordered
      )
    `
    )
    .eq("grn_id", grnId)
    .eq("is_active", true);

  if (itemsError) throw itemsError;

  let subtotal = 0;
  for (const item of items || []) {
    const posted = toQty(item.qty_qc_posted);
    const door = toQty(item.qty_diterima);
    const qty = posted > 0 ? posted : door;
    if (qty <= 0) continue;
    const harga = toQty(
      (item.purchase_order_item as { harga_satuan?: number | null } | null)?.harga_satuan
    );
    subtotal += qty * harga;
  }
  subtotal = round2(subtotal);

  let tax = 0;
  const poId = grn.purchase_order_id as string | null;
  if (poId && subtotal > 0) {
    const { data: po } = await db
      .from("purchase_orders")
      .select("ppn_persen, company_id")
      .eq("id", poId)
      .maybeSingle();
    const ppn = toQty(po?.ppn_persen);
    if (ppn > 0) {
      tax = round2((subtotal * ppn) / 100);
    }
  }

  const total = round2(subtotal + tax);
  let companyId = (grn.company_id as string | null) || null;
  if (!companyId && poId) {
    const { data: poCompany } = await db
      .from("purchase_orders")
      .select("company_id")
      .eq("id", poId)
      .maybeSingle();
    companyId = (poCompany?.company_id as string | null) || null;
  }

  return {
    companyId,
    entryDate: String(grn.tanggal_penerimaan || new Date().toISOString().slice(0, 10)),
    nomorGrn: String(grn.nomor_grn || grnId),
    amounts: {
      SUBTOTAL: subtotal,
      TAX: tax,
      TOTAL: total,
    },
  };
}

export function buildPaymentAccountingAmounts(amount: number): JournalAmountMap {
  const paid = round2(Math.max(0, Number(amount) || 0));
  return {
    PAID: paid,
    TOTAL: paid,
    SUBTOTAL: paid,
  };
}

export function buildReturnAccountingAmounts(totalAmount: number): JournalAmountMap {
  const total = round2(Math.max(0, Number(totalAmount) || 0));
  return {
    TOTAL: total,
    SUBTOTAL: total,
  };
}

/** Pure helper for tests: GRN line qty × price → amounts. */
export function computeGrnAmountsFromLines(
  lines: Array<{ qty: number; harga_satuan: number }>,
  ppnPersen = 0
): JournalAmountMap {
  let subtotal = 0;
  for (const line of lines) {
    subtotal += Math.max(0, Number(line.qty) || 0) * Math.max(0, Number(line.harga_satuan) || 0);
  }
  subtotal = round2(subtotal);
  const tax = ppnPersen > 0 ? round2((subtotal * ppnPersen) / 100) : 0;
  return {
    SUBTOTAL: subtotal,
    TAX: tax,
    TOTAL: round2(subtotal + tax),
  };
}

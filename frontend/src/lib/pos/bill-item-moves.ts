import { query } from "@/lib/db";

/**
 * Guard & audit pemindahan item antar bill (transfer meja / merge).
 *
 * Insiden production 2026-08-23 (POS-20260823-0132/0138): item dipindah dari/
 * ke bill yang sudah DIBAYAR — total dihitung ulang, amount_paid tidak, jadi
 * isi order tidak lagi cocok dengan struk maupun uang yang diterima. Aturan
 * baru: begitu ada uang masuk, isi bill terkunci (kontrak dengan struk).
 */

export interface BillPaymentSnapshot {
  payment_status?: string | null;
  amount_paid?: number | string | null;
}

/**
 * Alasan blokir (string) bila bill ini tidak boleh melepas/menerima item;
 * null = boleh. Diblokir bila status bayar 'paid'/'partial'/'refunded' ATAU
 * sudah ada uang tercatat (amount_paid > 0, menangkap pembayaran parsial
 * apa pun yang statusnya belum rapi).
 */
export function billBlocksItemMoves(bill: BillPaymentSnapshot): string | null {
  const status = String(bill.payment_status || "").toLowerCase();
  if (["paid", "partial", "refunded"].includes(status)) {
    return `sudah ${status === "paid" ? "dibayar" : status === "partial" ? "dibayar sebagian" : "di-refund"}`;
  }
  if ((Number(bill.amount_paid) || 0) > 0) {
    return "sudah menerima pembayaran";
  }
  return null;
}

export interface MovedItemSnapshot {
  id?: string | null;
  product_name?: string | null;
  quantity?: number | string | null;
  unit_price?: number | string | null;
  total_amount?: number | string | null;
}

/**
 * Audit trail — satu baris per aksi pemindahan, dengan snapshot item yang
 * pindah. Fire-and-forget + toleran tabel belum ada (42P01, sebelum migrasi
 * 014 jalan di production): kegagalan log TIDAK menggagalkan operasinya,
 * tapi selalu tercatat di console utk dilihat di log server.
 */
export async function logOrderItemMove(input: {
  action: "transfer" | "merge";
  sourceOrderId: string;
  sourceOrderNumber?: string | null;
  targetOrderId: string;
  targetOrderNumber?: string | null;
  items: MovedItemSnapshot[];
  movedBy?: string | null;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO pos.pos_order_item_move_logs
         (action, source_order_id, source_order_number, target_order_id, target_order_number, items, moved_by)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [
        input.action,
        input.sourceOrderId,
        input.sourceOrderNumber ?? null,
        input.targetOrderId,
        input.targetOrderNumber ?? null,
        JSON.stringify(
          input.items.map((item) => ({
            id: item.id ?? null,
            product_name: item.product_name ?? null,
            quantity: Number(item.quantity) || 0,
            unit_price: Number(item.unit_price) || 0,
            total_amount: Number(item.total_amount) || 0,
          }))
        ),
        input.movedBy ?? null,
      ]
    );
  } catch (error) {
    console.error(
      `[pos] gagal menulis audit item-move (${input.action} ${input.sourceOrderId} → ${input.targetOrderId}):`,
      error
    );
  }
}

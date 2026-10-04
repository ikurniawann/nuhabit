// Batalkan checkout unpaid yang belum punya anak-order (lepas dari meja).
import { withTransaction } from "@/lib/db";
import {
  canCancelUnpaidChildlessCheckout,
  isCancelledCheckout,
  unpaidCheckoutScopeSql,
  unpaidChildlessCheckoutCancelPatch,
} from "./rules";
import { MixedCheckoutError } from "./types";

export async function cancelUnpaidChildlessCheckout(
  checkoutId: string,
  scope: { companyId?: string | null; branchId?: string | null } = {}
): Promise<{ checkoutId: string }> {
  return withTransaction(async (client) => {
    const scoped = unpaidCheckoutScopeSql({
      companyId: scope.companyId,
      branchId: scope.branchId,
      startParam: 2,
    });
    const result = await client.query<{
      id: string;
      payment_status: string;
      notes: string | null;
      table_id: string | null;
    }>(
      `SELECT id, payment_status, notes, table_id
       FROM pos.pos_checkouts
       WHERE id = $1 ${scoped.sql}
       FOR UPDATE`,
      [checkoutId, ...scoped.params]
    );
    const row = result.rows[0];
    if (!row) {
      throw new MixedCheckoutError("Checkout tidak ditemukan", 404);
    }
    if (isCancelledCheckout(row)) {
      return { checkoutId: row.id };
    }
    const children = await client.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM pos.pos_orders WHERE checkout_id = $1`,
      [checkoutId]
    );
    const guard = canCancelUnpaidChildlessCheckout({
      paymentStatus: row.payment_status,
      childCount: children.rows[0]?.n ?? 0,
      notes: row.notes,
    });
    if (!guard.ok) {
      throw new MixedCheckoutError(guard.message);
    }
    const patch = unpaidChildlessCheckoutCancelPatch();
    await client.query(
      `UPDATE pos.pos_checkouts
       SET table_id = $2, notes = $3, updated_at = now()
       WHERE id = $1`,
      [checkoutId, patch.table_id, patch.notes]
    );
    return { checkoutId: row.id };
  });
}

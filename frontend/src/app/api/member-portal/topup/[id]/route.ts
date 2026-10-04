import { z } from "zod";
import { memberError, memberJson, withMemberSession } from "@/lib/member-portal/route";
import { createPgClient } from "@/lib/pg/create-client";
import { reconcilePendingTopup } from "@/lib/pos/topup-qris-reconcile";
import { memberTopupView } from "@/lib/wallet/member-topup";
import { loadMemberTopup } from "@/lib/wallet/topup";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET — status top-up milik member untuk polling. Selagi pending, server
 * menanyakan langsung ke Xendit (jalur rekonsiliasi kasir) supaya saldo tetap
 * masuk walau webhook terlambat.
 */
export const GET = withMemberSession("Gagal memuat status top-up", async (customerId, _request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return memberError("ID tidak valid");
  let row = await loadMemberTopup(customerId, id);
  if (!row) return memberError("Top-up tidak ditemukan", 404);
  if (row.status === "pending" && row.xendit_transaction_id) {
    const outcome = await reconcilePendingTopup(createPgClient(), id);
    if (outcome.status === "credited") row = (await loadMemberTopup(customerId, id)) ?? row;
  }
  return memberJson(memberTopupView(row));
});

import { z } from "zod";
import { memberError, memberJson, withMemberSession } from "@/lib/member-portal/route";
import { createPgClient } from "@/lib/pg/create-client";
import { creditPendingTopup } from "@/lib/pos/topup-credit";
import { canSimulateTopup, memberTopupView } from "@/lib/wallet/member-topup";
import { loadMemberTopup } from "@/lib/wallet/topup";

/**
 * POST — KHUSUS DEV LOKAL: tandai top-up pending sebagai lunas lewat jalur
 * kredit yang sama dengan webhook Xendit. Mati total di luar pengaman
 * dev-bypass (404, seolah route tidak ada).
 */
export const POST = withMemberSession(
  "Gagal mensimulasikan pembayaran",
  async (customerId, _request: Request, ctx: { params: Promise<{ id: string }> }) => {
    if (!canSimulateTopup()) return memberError("Not found", 404);
    const { id } = await ctx.params;
    if (!z.string().uuid().safeParse(id).success) return memberError("ID tidak valid");
    const row = await loadMemberTopup(customerId, id);
    if (!row) return memberError("Top-up tidak ditemukan", 404);
    if (row.status !== "pending") return memberError("Top-up tidak dalam status menunggu pembayaran");
    await creditPendingTopup(createPgClient(), {
      transactionId: id,
      xenditPaymentId: `dev_sim_${id}`,
      notes: "Top-up QRIS (simulasi dev lokal)",
    });
    const updated = await loadMemberTopup(customerId, id);
    return memberJson(updated ? memberTopupView(updated) : null);
  }
);

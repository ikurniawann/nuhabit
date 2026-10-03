import { z } from "zod";
import { IAM } from "@/lib/iam/prefixes";
import { createPgClient } from "@/lib/pg/create-client";
import { reconcilePendingTopup } from "@/lib/pos/topup-qris-reconcile";
import { fail, ok, walletRoute } from "@/lib/wallet/route";

/** POST — cek ulang ke Xendit dan kredit bila sudah dibayar (logika rekonsiliasi yang sama dengan kasir). */
export const POST = walletRoute(
  IAM.posWallet,
  "Gagal merekonsiliasi pembayaran",
  async (_user, _request: Request, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    if (!z.string().uuid().safeParse(id).success) return fail("ID tidak valid");
    const outcome = await reconcilePendingTopup(createPgClient(), id);
    if (outcome.status === "not_found") return fail("Pembayaran tidak ditemukan", 404);
    return ok(outcome);
  }
);

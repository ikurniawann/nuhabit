import type { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { createPgClient } from "@/lib/pg/create-client";
import { reconcilePendingTopup } from "@/lib/pos/topup-qris-reconcile";
import { ok, requireWalletAdmin, uuidParam, type IdContext } from "@/lib/wallet/route";

/** POST — cek ulang ke Xendit dan kredit bila sudah dibayar (logika rekonsiliasi yang sama dengan kasir). */
export const POST = apiHandler(async (_request: NextRequest, ctx: IdContext) => {
  await requireWalletAdmin();
  const outcome = await reconcilePendingTopup(createPgClient(), await uuidParam(ctx));
  if (outcome.status === "not_found") throw ApiError.notFound("Pembayaran tidak ditemukan");
  return ok(outcome);
}, "wallet.payments.reconcile.POST");

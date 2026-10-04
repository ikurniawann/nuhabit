import { z } from "zod";
import { simulateMemberPurchasePaid } from "@/lib/gym/credit-payments-server";
import { GymCreditError } from "@/lib/gym/credits-server";
import { memberError, memberJson, withMemberSession } from "@/lib/member-portal/route";
import { canSimulateTopup } from "@/lib/wallet/member-topup";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST — KHUSUS DEV LOKAL: lunasi QR pembelian paket lewat jalur yang sama
 * dengan webhook. Di luar pengaman dev-bypass route ini 404.
 */
export const POST = withMemberSession("Gagal mensimulasikan pembayaran", async (customerId, _request: Request, ctx: Ctx) => {
  if (!canSimulateTopup()) return memberError("Not found", 404);
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return memberError("ID tidak valid");
  try {
    const purchase = await simulateMemberPurchasePaid(customerId, id);
    return purchase ? memberJson(purchase) : memberError("Pembelian tidak ditemukan", 404);
  } catch (error) {
    if (error instanceof GymCreditError) return memberError(error.message, error.status);
    throw error;
  }
});

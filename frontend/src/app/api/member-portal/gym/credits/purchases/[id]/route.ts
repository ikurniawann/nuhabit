import { z } from "zod";
import { refreshMemberPurchase } from "@/lib/gym/credit-payments-server";
import { memberError, memberJson, withMemberSession } from "@/lib/member-portal/route";

type Ctx = { params: Promise<{ id: string }> };

/** GET — status pembelian untuk polling; selagi pending server mengecek Xendit langsung. */
export const GET = withMemberSession("Gagal memuat status pembelian", async (customerId, _request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return memberError("ID tidak valid");
  const purchase = await refreshMemberPurchase(customerId, id);
  return purchase ? memberJson(purchase) : memberError("Pembelian tidak ditemukan", 404);
});

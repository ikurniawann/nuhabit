import { NextRequest } from "next/server";
import { appOrigin } from "@/lib/app-origin";
import { z } from "zod";
import { rejectIfArkCoinDisabled } from "@/lib/crm/loyalty-features-server";
import { memberError, memberJson, withMemberSession } from "@/lib/member-portal/route";
import { createMemberTopup, loadMemberTopupOptions } from "@/lib/wallet/member-topup";
import { WalletError } from "@/lib/wallet/server";

const schema = z
  .object({
    package_id: z.string().uuid().optional().nullable(),
    amount: z.number().int().positive().optional().nullable(),
  })
  .refine((b) => Boolean(b.package_id) !== Boolean(b.amount), { message: "Pilih paket atau isi nominal" });

/** GET — paket online, batas nominal, saldo, dan QR pending terakhir milik member. */
export const GET = withMemberSession("Gagal memuat top-up", async (customerId) => {
  const blocked = await rejectIfArkCoinDisabled(true);
  if (blocked) return blocked;
  return memberJson(await loadMemberTopupOptions(customerId));
});

/** POST { package_id } atau { amount } — buat QRIS dinamis; saldo masuk setelah dibayar. */
export const POST = withMemberSession("Gagal membuat top-up", async (customerId, request: NextRequest) => {
  const blocked = await rejectIfArkCoinDisabled(true);
  if (blocked) return blocked;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return memberError(parsed.error.issues[0]?.message ?? "Data tidak valid");
  const origin = appOrigin(request);
  try {
    const topup = await createMemberTopup({
      customerId,
      packageId: parsed.data.package_id,
      amount: parsed.data.amount,
      webhookUrl: (configured) => configured || `${origin}/api/payments/xendit/webhook`,
    });
    return memberJson(topup);
  } catch (error) {
    if (error instanceof WalletError) return memberError(error.message, error.status);
    throw error;
  }
});

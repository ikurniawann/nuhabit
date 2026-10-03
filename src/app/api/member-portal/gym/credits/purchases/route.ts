import { NextRequest } from "next/server";
import { z } from "zod";
import { rejectIfArkCoinDisabled } from "@/lib/crm/loyalty-features-server";
import { buyPackageWithArk, startQrisPurchase } from "@/lib/gym/credit-payments-server";
import { GymCreditError } from "@/lib/gym/credits-server";
import { memberError, memberJson, withMemberSession } from "@/lib/member-portal/route";

const schema = z.object({
  package_id: z.string().uuid("Pilih paket"),
  method: z.enum(["qris", "ark_coin"]),
});

/**
 * POST { package_id, method } — beli paket kredit.
 * qris: QRIS dinamis, kredit terbit setelah webhook/polling melihat lunas.
 * ark_coin: saldo ARK dipotong dan kredit terbit saat itu juga.
 */
export const POST = withMemberSession("Gagal membeli paket", async (customerId, request: NextRequest) => {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return memberError(parsed.error.issues[0]?.message ?? "Data tidak valid");
  const { package_id: packageId, method } = parsed.data;
  const blocked = await rejectIfArkCoinDisabled(method === "ark_coin");
  if (blocked) return blocked;
  const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || request.nextUrl.origin;
  try {
    return memberJson(
      method === "ark_coin"
        ? await buyPackageWithArk(customerId, packageId)
        : await startQrisPurchase({
            customerId,
            packageId,
            callbackUrl: (configured) => configured || `${origin}/api/payments/xendit/webhook`,
          })
    );
  } catch (error) {
    if (error instanceof GymCreditError) return memberError(error.message, error.status);
    throw error;
  }
});

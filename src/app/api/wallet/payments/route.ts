import { IAM } from "@/lib/iam/prefixes";
import { listOnlinePayments, paymentFiltersSchema } from "@/lib/wallet/payments";
import { ok, walletRoute } from "@/lib/wallet/route";

/** GET — top-up QRIS online (kasir & portal) dengan filter status/sumber/tanggal/cari. */
export const GET = walletRoute(IAM.posWallet, "Gagal memuat pembayaran online", async (_user, request: Request) => {
  const params = Object.fromEntries(
    [...new URL(request.url).searchParams.entries()].filter(([, value]) => value !== "")
  );
  return ok(await listOnlinePayments(paymentFiltersSchema.parse(params)));
});

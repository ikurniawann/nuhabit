import { apiHandler } from "@/lib/api/handler";
import { ok, requireWalletAdmin } from "@/lib/wallet/route";
import { listActiveBranches } from "@/lib/wallet/topup";

/** GET — cabang aktif, untuk membatasi paket top-up per cabang. */
export const GET = apiHandler(async () => {
  await requireWalletAdmin();
  return ok(await listActiveBranches());
}, "wallet.branches.GET");

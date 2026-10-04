import { apiHandler } from "@/lib/api/handler";
import { ok, requireWalletAdmin } from "@/lib/wallet/route";
import { listSweepRuns, runWalletSweep } from "@/lib/wallet/sweep";

/** GET — 10 sapuan terakhir (otomatis tiap jam & manual). */
export const GET = apiHandler(async () => {
  await requireWalletAdmin();
  return ok(await listSweepRuns());
}, "wallet.sweep.GET");

/** POST — "Jalankan sekarang": kedaluwarsa, pengingat, saldo rendah. */
export const POST = apiHandler(async () => {
  const user = await requireWalletAdmin();
  return ok(await runWalletSweep({ trigger: "manual", actorId: user.id }));
}, "wallet.sweep.POST");

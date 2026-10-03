import { IAM } from "@/lib/iam/prefixes";
import { ok, walletRoute } from "@/lib/wallet/route";
import { listSweepRuns, runWalletSweep } from "@/lib/wallet/sweep";

/** GET — 10 sapuan terakhir (otomatis tiap jam & manual). */
export const GET = walletRoute(IAM.posWallet, "Gagal memuat riwayat sapuan", async () => ok(await listSweepRuns()));

/** POST — "Jalankan sekarang": kedaluwarsa, pengingat, saldo rendah. */
export const POST = walletRoute(IAM.posWallet, "Sapuan dompet gagal", async (user) =>
  ok(await runWalletSweep({ trigger: "manual", actorId: user.id }))
);

import { z } from "zod";
import { IAM } from "@/lib/iam/prefixes";
import { ok, walletRoute } from "@/lib/wallet/route";
import { loadWalletSettings, saveWalletSettings } from "@/lib/wallet/server";

const settingsSchema = z.object({
  topup_max_amount: z.number().min(0).max(1_000_000_000),
  low_balance_threshold_idr: z.number().min(0).max(100_000_000),
  wallet_default_validity_days: z.number().int().min(1).max(3_650).nullable(),
  wallet_expiry_reminder_days: z.number().int().min(0).max(90),
});

export const GET = walletRoute(IAM.posWallet, "Gagal memuat aturan saldo", async () => ok(await loadWalletSettings()));

export const PUT = walletRoute(IAM.posWallet, "Gagal menyimpan aturan saldo", async (user, request: Request) => {
  const input = settingsSchema.parse(await request.json());
  return ok(await saveWalletSettings(input, user.id));
});

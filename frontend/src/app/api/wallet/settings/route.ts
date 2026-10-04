import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { ok, parseInput, requireWalletAdmin } from "@/lib/wallet/route";
import { loadWalletSettings, saveWalletSettings } from "@/lib/wallet/server";

const settingsSchema = z.object({
  topup_max_amount: z.number().min(0).max(1_000_000_000),
  low_balance_threshold_idr: z.number().min(0).max(100_000_000),
  wallet_default_validity_days: z.number().int().min(1).max(3_650).nullable(),
  wallet_expiry_reminder_days: z.number().int().min(0).max(90),
});

export const GET = apiHandler(async () => {
  await requireWalletAdmin();
  return ok(await loadWalletSettings());
}, "wallet.settings.GET");

export const PUT = apiHandler(async (request: NextRequest) => {
  const user = await requireWalletAdmin();
  const input = parseInput(settingsSchema, await request.json());
  return ok(await saveWalletSettings(input, user.id));
}, "wallet.settings.PUT");

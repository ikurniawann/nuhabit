import { IAM } from "@/lib/iam/prefixes";
import { createPgClient } from "@/lib/pg/create-client";
import { resolveTopupVenue } from "@/lib/pos/topup-venue";
import { packageInputSchema } from "@/lib/wallet/packages";
import { ok, walletRoute } from "@/lib/wallet/route";
import { listPackages, savePackage } from "@/lib/wallet/topup";

/** Kasir: paket aktif yang dijual di cabangnya (gerbang menu POS). */
const listForCashier = walletRoute(IAM.pos, "Gagal memuat paket top-up", async (user) => {
  const venue = await resolveTopupVenue(createPgClient(), user.id);
  return ok(await listPackages("cashier", venue.branchId));
});

const listForAdmin = walletRoute(IAM.posWallet, "Gagal memuat paket top-up", async () => ok(await listPackages("admin")));

/** GET ?scope=cashier — paket untuk layar top-up kasir; tanpa scope = semua paket (admin). */
export function GET(request: Request) {
  return new URL(request.url).searchParams.get("scope") === "cashier" ? listForCashier() : listForAdmin();
}

/** POST — paket baru. */
export const POST = walletRoute(IAM.posWallet, "Gagal menyimpan paket", async (user, request: Request) => {
  const input = packageInputSchema.parse(await request.json());
  return ok(await savePackage(null, input, user.id), 201);
});

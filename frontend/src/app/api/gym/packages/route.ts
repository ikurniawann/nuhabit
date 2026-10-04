import type { NextRequest } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { listPackagesAdmin, packageSchema, savePackage } from "@/lib/gym/credit-packages-server";
import { ok, parseBody } from "@/lib/gym/staff-route";
import { IAM } from "@/lib/iam/prefixes";

/**
 * GET: semua paket (aktif dulu) + jenis kelas aktif untuk pilihan cakupan.
 * Front desk (Kredit Member) ikut membaca untuk menjual.
 */
export const GET = apiHandler(async () => {
  await requireIamMenuPrefix([...IAM.gymPackages, ...IAM.gymCredits]);
  return ok(await listPackagesAdmin());
}, "gym.packages.GET");

/** POST: buat atau ubah paket. Pembelian lama tetap memakai kredit & harga saat dibeli. */
export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.gymPackages);
  const input = await parseBody(request, packageSchema, "issue");
  return ok(await savePackage(input, user.id));
}, "gym.packages.POST");

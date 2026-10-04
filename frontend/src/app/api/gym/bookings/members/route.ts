import type { NextRequest } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { searchBookableMembers } from "@/lib/gym/credits-admin-server";
import { ok } from "@/lib/gym/staff-route";
import { IAM } from "@/lib/iam/prefixes";

/** GET ?q=: cari member (nama/telepon) untuk didaftarkan ke kelas, dengan saldo kredit. */
export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.gymScheduling);
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  return ok(await searchBookableMembers(q));
}, "gym.bookings.members.GET");

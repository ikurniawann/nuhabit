import { issueMemberQr } from "@/lib/crm/engagement/server";
import { QR_TTL_SECONDS } from "@/lib/crm/engagement/rules";
import { memberJson, withMemberSession } from "@/lib/member-portal/route";

/** POST — terbitkan QR check-in baru (acak, sekali pakai, umur 60 detik). */
export const POST = withMemberSession("Gagal membuat QR", async (customerId) => {
  const qr = await issueMemberQr(customerId);
  return memberJson({ ...qr, ttl_seconds: QR_TTL_SECONDS });
});

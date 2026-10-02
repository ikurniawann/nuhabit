import { randomBytes } from "node:crypto";
import { ApiError } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { hashSecret } from "@/lib/member-portal/otp";

/**
 * Staf membuka Member App atas nama member tanpa OTP (preview / bantu member).
 * Hanya aktif bila MEMBER_PREVIEW_ENABLED=1 (dinyalakan di DEV); sesi pendek
 * dan setiap pemakaian tercatat di studio.member_preview_log.
 */
export const MEMBER_PREVIEW_TTL_MS = 4 * 60 * 60 * 1000;
/** Cookie penanda (bisa dibaca klien) → banner "Staff preview" di Member App. */
export const MEMBER_PREVIEW_COOKIE = "member_preview";

export function isMemberPreviewEnabled(): boolean {
  return process.env.MEMBER_PREVIEW_ENABLED === "1";
}

export async function createPreviewSession(customerId: string, staffUserId: string): Promise<{ token: string; memberName: string | null }> {
  if (!isMemberPreviewEnabled()) throw ApiError.notFound("Fitur tidak tersedia");
  const member = await queryOne<{ id: string; name: string | null }>(
    `SELECT id, name FROM pos.pos_customers WHERE id = $1 AND is_active IS NOT FALSE`,
    [customerId]
  );
  if (!member) throw ApiError.notFound("Member tidak ditemukan");
  const token = randomBytes(32).toString("hex");
  await query(
    `INSERT INTO crm.member_portal_sessions (token_hash, customer_id, expires_at) VALUES ($1, $2, $3)`,
    [hashSecret(token), customerId, new Date(Date.now() + MEMBER_PREVIEW_TTL_MS)]
  );
  await query(`INSERT INTO studio.member_preview_log (customer_id, staff_user_id) VALUES ($1, $2)`, [customerId, staffUserId]);
  console.warn(`[member-preview] staf ${staffUserId} membuka Member App sebagai ${customerId}`);
  return { token, memberName: member.name };
}

import { NextRequest, NextResponse } from "next/server";
import { getPosSession } from "@/lib/api/auth";
import { query } from "@/lib/db";
import { normalizeNfcUid } from "@/lib/pos/nfc-uid";

/**
 * GET /api/pos/member-cards?search=&nfc_uid=
 * Daftar member yang punya kartu NFC tertaut (untuk halaman Unlink Card)
 * + riwayat unlink terakhir + permintaan refund (owner 2026-09-04). `nfc_uid` dipakai saat kartu di-tap: hasil
 * tepat satu member, atau kosong bila kartu tidak terdaftar / sudah dilepas.
 */
export async function GET(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }

  try {
    const params = request.nextUrl.searchParams;
    const search = (params.get("search") ?? "").trim();
    const nfcUid = normalizeNfcUid(params.get("nfc_uid") ?? "");

    const where: string[] = ["c.is_active = true", "c.nfc_uid IS NOT NULL"];
    const values: unknown[] = [];
    if (nfcUid) {
      values.push(nfcUid);
      where.push(`upper(c.nfc_uid) = upper($${values.length})`);
    } else if (search) {
      values.push(`%${search}%`);
      where.push(
        `(c.name ILIKE $${values.length} OR c.phone ILIKE $${values.length} OR c.nfc_uid ILIKE $${values.length})`
      );
    }

    const [members, recentUnlinks, refundRequests] = await Promise.all([
      query(
        `SELECT c.id, c.name, c.phone, c.email, c.membership_tier, c.member_type,
                c.ark_coin_balance, c.total_xp, c.nfc_uid, c.card_issued_at
         FROM pos.pos_customers c
         WHERE ${where.join(" AND ")}
         ORDER BY c.name NULLS LAST, c.phone
         LIMIT ${nfcUid ? 1 : 300}`,
        values
      ),
      query(
        `SELECT l.id, l.customer_id, c.name, c.phone, l.nfc_uid, l.reason, l.notes,
                l.balance_at_unlink, l.unlinked_by_name, l.created_at
         FROM pos.pos_card_unlink_logs l
         JOIN pos.pos_customers c ON c.id = l.customer_id
         ORDER BY l.created_at DESC
         LIMIT 20`
      ),
      // Permintaan refund: yang menunggu Finance di atas, lalu 30 terakhir.
      query(
        `SELECT r.id, r.customer_id, c.name, c.phone, c.ark_coin_balance AS current_balance,
                r.status, r.requested_amount, r.refunded_amount, r.notes,
                r.requested_by_name, r.requested_at, r.completed_by_name, r.approved_by_name,
                r.completed_at, r.completion_notes, r.cancelled_by_name, r.cancelled_at, r.cancel_reason
         FROM pos.pos_member_refund_requests r
         JOIN pos.pos_customers c ON c.id = r.customer_id
         ORDER BY (r.status = 'requested') DESC, r.requested_at DESC
         LIMIT 50`
      ),
    ]);

    return NextResponse.json({
      success: true,
      data: { members, recent_unlinks: recentUnlinks, refund_requests: refundRequests },
    });
  } catch (error) {
    console.error("[pos] member-cards GET:", error);
    return NextResponse.json({ success: false, error: "Gagal memuat data kartu member" }, { status: 500 });
  }
}

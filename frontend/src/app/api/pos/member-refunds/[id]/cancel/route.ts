import { NextRequest, NextResponse } from "next/server";
import { getPosSession } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { normalizeNotes } from "@/lib/pos/member-refund";

/**
 * POST /api/pos/member-refunds/[id]/cancel  { reason? }
 * Batalkan permintaan refund yang masih menunggu (mis. member berubah
 * pikiran / kartu dipasang lagi). Saldo tidak berubah.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ success: false, error: "ID permintaan tidak valid" }, { status: 400 });
    }
    const body = await request.json().catch(() => ({}));
    const reason = normalizeNotes(body?.reason);
    if (!reason.ok) return NextResponse.json({ success: false, error: reason.error }, { status: 400 });

    const actor = await queryOne<{ full_name: string | null }>(
      `SELECT full_name FROM configuration.users WHERE id = $1`,
      [sessionUserId]
    );
    const rows = await query<{ id: string }>(
      `UPDATE pos.pos_member_refund_requests
       SET status = 'cancelled', cancelled_by = $2, cancelled_by_name = $3, cancelled_at = now(),
           cancel_reason = $4, updated_at = now()
       WHERE id = $1 AND status = 'requested' RETURNING id`,
      [id, sessionUserId, actor?.full_name?.trim() || "Kasir", reason.notes]
    );
    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: "Permintaan tidak ditemukan atau sudah diproses" }, { status: 409 });
    }
    return NextResponse.json({ success: true, message: "Permintaan refund dibatalkan — saldo member tetap", data: { request_id: id } });
  } catch (error) {
    console.error("[pos] member-refunds cancel:", error);
    return NextResponse.json({ success: false, error: "Gagal membatalkan permintaan" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getPosSession } from "@/lib/api/auth";
import { queryOne, withTransaction } from "@/lib/db";
import { normalizeNotes } from "@/lib/pos/member-refund";
import { formatRupiah } from "@/lib/format";

/**
 * POST /api/pos/member-cards/[id]/refund  { notes? }
 * Tombol "Refund" di halaman Unlink Card (owner 2026-09-04): kartu NFC
 * dilepas (alasan 'refund') DAN permintaan refund dicatat dengan saldo saat
 * itu, status 'requested'. Saldo member BELUM diubah — baru di-nol-kan saat
 * Finance mengonfirmasi dan permintaan ditandai Refund Completed.
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
      return NextResponse.json({ success: false, error: "ID member tidak valid" }, { status: 400 });
    }
    const body = await request.json().catch(() => ({}));
    const notes = normalizeNotes(body?.notes);
    if (!notes.ok) return NextResponse.json({ success: false, error: notes.error }, { status: 400 });

    const actor = await queryOne<{ full_name: string | null; company_id: string | null; branch_id: string | null }>(
      `SELECT full_name, company_id, branch_id FROM configuration.users WHERE id = $1`,
      [sessionUserId]
    );
    const actorName = actor?.full_name?.trim() || "Kasir";

    const result = await withTransaction(async (client) => {
      const cust = await client.query<{
        id: string; name: string | null; phone: string; nfc_uid: string | null; ark_coin_balance: string | number | null;
      }>(
        `SELECT id, name, phone, nfc_uid, ark_coin_balance
         FROM pos.pos_customers WHERE id = $1 AND is_active FOR UPDATE`,
        [id]
      );
      const customer = cust.rows[0];
      if (!customer) return { error: "Member tidak ditemukan", status: 404 as const };
      if (!customer.nfc_uid) {
        return { error: "Member ini tidak punya kartu yang tertaut", status: 400 as const };
      }
      const open = await client.query(
        `SELECT id FROM pos.pos_member_refund_requests WHERE customer_id = $1 AND status = 'requested'`,
        [customer.id]
      );
      if (open.rows[0]) {
        return { error: "Member ini sudah punya permintaan refund yang belum selesai", status: 409 as const };
      }
      const balance = Number(customer.ark_coin_balance) || 0;

      const log = await client.query<{ id: string }>(
        `INSERT INTO pos.pos_card_unlink_logs
           (customer_id, nfc_uid, reason, notes, balance_at_unlink, unlinked_by, unlinked_by_name)
         VALUES ($1, $2, 'refund', $3, $4, $5, $6) RETURNING id`,
        [customer.id, customer.nfc_uid, notes.notes, balance, sessionUserId, actorName]
      );
      await client.query(
        `UPDATE pos.pos_customers SET nfc_uid = NULL, card_issued_at = NULL, updated_at = now() WHERE id = $1`,
        [customer.id]
      );
      const req = await client.query<{ id: string; requested_at: string }>(
        `INSERT INTO pos.pos_member_refund_requests
           (customer_id, unlink_log_id, status, requested_amount, notes, requested_by, requested_by_name, company_id, branch_id)
         VALUES ($1, $2, 'requested', $3, $4, $5, $6, $7, $8) RETURNING id, requested_at`,
        [customer.id, log.rows[0].id, balance, notes.notes, sessionUserId, actorName, actor?.company_id ?? null, actor?.branch_id ?? null]
      );

      return {
        data: {
          request_id: req.rows[0].id,
          requested_at: req.rows[0].requested_at,
          customer: { id: customer.id, name: customer.name, phone: customer.phone, ark_coin_balance: balance },
          previous_nfc_uid: customer.nfc_uid,
          requested_by_name: actorName,
        },
      };
    });

    if ("error" in result) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    const c = result.data.customer;
    return NextResponse.json({
      success: true,
      message: `Kartu ${result.data.previous_nfc_uid} dilepas & refund ${formatRupiah(c.ark_coin_balance)} untuk ${c.name || c.phone} diajukan ke Finance`,
      data: result.data,
    });
  } catch (error) {
    console.error("[pos] member-cards refund:", error);
    return NextResponse.json({ success: false, error: "Gagal mengajukan refund" }, { status: 500 });
  }
}

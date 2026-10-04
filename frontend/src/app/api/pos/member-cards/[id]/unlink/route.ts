import { NextRequest, NextResponse } from "next/server";
import { getPosSession } from "@/lib/api/auth";
import { queryOne, withTransaction } from "@/lib/db";
import { validateCardUnlink } from "@/lib/pos/card-unlink";

/**
 * POST /api/pos/member-cards/[id]/unlink  { reason, notes? }
 * Lepaskan kartu NFC dari member (owner 2026-09-01): nfc_uid dikosongkan
 * supaya kartu lama tidak bisa dipakai (hilang) atau bisa diberikan ke
 * orang lain (dikembalikan). Saldo ARK & XP member TIDAK diubah. Setiap
 * unlink dicatat ke pos_card_unlink_logs beserta alasan & siapa yang
 * melakukannya.
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
    const valid = validateCardUnlink(body);
    if (!valid.ok) {
      return NextResponse.json({ success: false, error: valid.error }, { status: 400 });
    }

    const actor = await queryOne<{ full_name: string | null }>(
      `SELECT full_name FROM configuration.users WHERE id = $1`,
      [sessionUserId]
    );
    const actorName = actor?.full_name?.trim() || "Kasir";

    const result = await withTransaction(async (client) => {
      const cust = await client.query<{
        id: string;
        name: string | null;
        phone: string;
        nfc_uid: string | null;
        ark_coin_balance: string | number | null;
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

      const log = await client.query(
        `INSERT INTO pos.pos_card_unlink_logs
           (customer_id, nfc_uid, reason, notes, balance_at_unlink, unlinked_by, unlinked_by_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, created_at`,
        [
          customer.id,
          customer.nfc_uid,
          valid.reason,
          valid.notes,
          Number(customer.ark_coin_balance) || 0,
          sessionUserId,
          actorName,
        ]
      );

      // Hanya tautan kartu yang dilepas — saldo, XP, tier, member_type utuh.
      await client.query(
        `UPDATE pos.pos_customers
         SET nfc_uid = NULL, card_issued_at = NULL, updated_at = now()
         WHERE id = $1`,
        [customer.id]
      );

      return {
        data: {
          customer: {
            id: customer.id,
            name: customer.name,
            phone: customer.phone,
            ark_coin_balance: Number(customer.ark_coin_balance) || 0,
          },
          previous_nfc_uid: customer.nfc_uid,
          reason: valid.reason,
          notes: valid.notes,
          unlinked_by_name: actorName,
          log_id: log.rows[0]?.id,
        },
      };
    });

    if ("error" in result) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({
      success: true,
      message: `Kartu ${result.data.previous_nfc_uid} dilepas dari ${result.data.customer.name || result.data.customer.phone} — saldo tetap utuh`,
      data: result.data,
    });
  } catch (error) {
    console.error("[pos] member-cards unlink:", error);
    return NextResponse.json({ success: false, error: "Gagal melepas kartu" }, { status: 500 });
  }
}

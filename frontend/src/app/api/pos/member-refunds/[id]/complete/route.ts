import { NextRequest, NextResponse } from "next/server";
import { getPosSession } from "@/lib/api/auth";
import { queryOne, withTransaction } from "@/lib/db";
import {
  REFUND_WALLET_METHOD, REFUND_WALLET_TYPE, buildRefundWalletNotes, normalizeNotes, refundCompletedMessage,
} from "@/lib/pos/member-refund";
import { approveWithSupervisorPin, supervisorPinRejection } from "@/lib/pos/supervisor-pin-server";

/**
 * POST /api/pos/member-refunds/[id]/complete  { supervisor_pin, notes? }
 * Finance sudah mengembalikan uang → permintaan ditandai Refund Completed
 * dan saldo ARK member di-nol-kan (transaksi wallet type 'withdrawal',
 * payment_method 'refund', balance_before = saldo saat ini, balance_after
 * = 0). Butuh PIN supervisor karena mengubah saldo. XP tidak disentuh.
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
    const notes = normalizeNotes(body?.notes);
    if (!notes.ok) return NextResponse.json({ success: false, error: notes.error }, { status: 400 });
    const pin = String(body?.supervisor_pin ?? "").trim();
    if (!pin) {
      return NextResponse.json({ success: false, error: "Refund Completed membutuhkan PIN supervisor" }, { status: 400 });
    }
    const approval = await approveWithSupervisorPin({ callerId: sessionUserId, pin });
    if (!approval.ok) return supervisorPinRejection(approval);
    const approver = approval.supervisor;

    const actor = await queryOne<{ full_name: string | null }>(
      `SELECT full_name FROM configuration.users WHERE id = $1`,
      [sessionUserId]
    );
    const actorName = actor?.full_name?.trim() || "Kasir";

    const result = await withTransaction(async (client) => {
      const reqRow = await client.query<{
        id: string; customer_id: string; status: string; requested_amount: string | number;
        company_id: string | null; branch_id: string | null;
      }>(
        `SELECT id, customer_id, status, requested_amount, company_id, branch_id
         FROM pos.pos_member_refund_requests WHERE id = $1 FOR UPDATE`,
        [id]
      );
      const req = reqRow.rows[0];
      if (!req) return { error: "Permintaan refund tidak ditemukan", status: 404 as const };
      if (req.status !== "requested") {
        return { error: `Permintaan ini sudah ${req.status === "completed" ? "selesai" : "dibatalkan"}`, status: 409 as const };
      }
      const cust = await client.query<{ id: string; name: string | null; phone: string; ark_coin_balance: string | number | null }>(
        `SELECT id, name, phone, ark_coin_balance FROM pos.pos_customers WHERE id = $1 FOR UPDATE`,
        [req.customer_id]
      );
      const customer = cust.rows[0];
      if (!customer) return { error: "Member tidak ditemukan", status: 404 as const };
      const balanceBefore = Number(customer.ark_coin_balance) || 0;

      const tx = await client.query<{ id: string }>(
        `INSERT INTO pos.pos_wallet_transactions
           (customer_id, type, amount, ark_coins, balance_before, balance_after, payment_method, status, notes, metadata, company_id, branch_id)
         VALUES ($1, $2, $3, $3, $4, 0, $5, 'completed', $6, $7::jsonb, $8, $9) RETURNING id`,
        [
          customer.id, REFUND_WALLET_TYPE, balanceBefore, balanceBefore, REFUND_WALLET_METHOD,
          buildRefundWalletNotes({ approverName: approver.name, requestId: req.id }),
          JSON.stringify({
            refund_request_id: req.id, requested_amount: Number(req.requested_amount) || 0,
            approved_by_id: approver.id, approved_by_name: approver.name,
            completed_by_id: sessionUserId, completed_by_name: actorName, xp_awarded: false,
          }),
          req.company_id, req.branch_id,
        ]
      );
      await client.query(
        `UPDATE pos.pos_customers SET ark_coin_balance = 0, updated_at = now() WHERE id = $1`,
        [customer.id]
      );
      await client.query(
        `UPDATE pos.pos_member_refund_requests
         SET status = 'completed', refunded_amount = $2, completed_by = $3, completed_by_name = $4,
             approved_by_id = $5, approved_by_name = $6, completed_at = now(), completion_notes = $7,
             wallet_transaction_id = $8, updated_at = now()
         WHERE id = $1`,
        [req.id, balanceBefore, sessionUserId, actorName, approver.id, approver.name, notes.notes, tx.rows[0].id]
      );
      return {
        data: {
          request_id: req.id,
          customer: { id: customer.id, name: customer.name, phone: customer.phone },
          refunded_amount: balanceBefore,
          balance_after: 0,
          wallet_transaction_id: tx.rows[0].id,
          approved_by_name: approver.name,
        },
      };
    });

    if ("error" in result) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({
      success: true,
      message: refundCompletedMessage({ ...result.data.customer, amount: result.data.refunded_amount }),
      data: result.data,
    });
  } catch (error) {
    console.error("[pos] member-refunds complete:", error);
    return NextResponse.json({ success: false, error: "Gagal menyelesaikan refund" }, { status: 500 });
  }
}

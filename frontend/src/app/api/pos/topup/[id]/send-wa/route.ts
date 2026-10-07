import { NextRequest, NextResponse } from "next/server";
import { createPgClient } from "@/lib/pg/create-client";
import { getPosSession } from "@/lib/api/auth";
import { queryOne } from "@/lib/db";
import { sendWhatsAppText } from "@/lib/whatsapp";
import {
  buildTopupReceiptMessage,
  normalizeWaPhone,
} from "@/lib/pos/receipt-wa";

/**
 * POST /api/pos/topup/[id]/send-wa — kirim bukti top-up via WhatsApp.
 *
 * Body: { phone?: string } — default ke nomor member pemilik dompet.
 * Data dimuat ulang dari pos_wallet_transactions; hanya top-up yang sudah
 * sukses yang boleh dikirimkan buktinya.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, error: "Authentication required" },
      { status: 401 }
    );
  }

  try {
    const { id: topupId } = await params;
    const body = (await request.json().catch(() => ({}))) as { phone?: string };
    const db = createPgClient();

    const { data: txn } = await db
      .from("pos_wallet_transactions")
      .select(
        `id, type, amount, balance_after, payment_method, status, created_at,
         customer:pos_customers(name, phone)`
      )
      .eq("id", topupId)
      .single();

    if (!txn) {
      return NextResponse.json(
        { success: false, error: "Transaksi top-up tidak ditemukan" },
        { status: 404 }
      );
    }
    // Status pending/failed tidak boleh dikirim sebagai "bukti" — itu janji
    // palsu ke pelanggan. Baris lama tanpa kolom status dianggap sukses.
    const status = String(txn.status ?? "completed").toLowerCase();
    if (["pending", "failed", "cancelled", "expired"].includes(status)) {
      return NextResponse.json(
        { success: false, error: "Top-up belum berhasil — bukti tidak dikirim" },
        { status: 400 }
      );
    }

    const customer = txn.customer as { name?: string | null; phone?: string | null } | null;
    const phone = normalizeWaPhone(body.phone ?? customer?.phone);
    if (!phone) {
      return NextResponse.json(
        { success: false, error: "Nomor WA tidak valid — periksa kembali" },
        { status: 400 }
      );
    }

    const outlet = await queryOne<{ name: string }>(
      "SELECT name FROM configuration.companies ORDER BY created_at LIMIT 1"
    );

    const balanceAfter = txn.balance_after === null ? null : Number(txn.balance_after);
    const message = buildTopupReceiptMessage({
      outletName: outlet?.name ?? "Kasir",
      customerName: customer?.name ?? "Pelanggan",
      amount: Number(txn.amount) || 0,
      method: String(txn.payment_method ?? "cash"),
      balanceAfter: Number.isFinite(balanceAfter as number) ? balanceAfter : null,
      at: String(txn.created_at ?? new Date().toISOString()),
    });

    const result = await sendWhatsAppText(
      { target: phone, message },
      { messageType: "notification", sentByUserId: sessionUserId }
    );

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.reason ?? "Gagal mengirim WA" },
        { status: 502 }
      );
    }
    return NextResponse.json({ success: true, data: { phone } });
  } catch (error) {
    console.error("[pos:topup:send-wa] gagal:", error);
    return NextResponse.json(
      { success: false, error: "Gagal mengirim bukti top-up" },
      { status: 500 }
    );
  }
}

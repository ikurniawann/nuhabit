import { NextRequest, NextResponse } from "next/server";
import { getPosSession } from "@/lib/api/auth";
import { query } from "@/lib/db";
import { isPaymentProofPathFor } from "@/lib/payments/static-qris";
import { readPrivateFile } from "@/lib/storage-private";
import { isUuid } from "@/lib/table-order/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/pos/orders/[id]/payment-proof — bukti bayar Static QRIS yang
 * diunggah pemesan self-order, untuk diperiksa kasir sebelum melunasi.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getPosSession();
  if (!userId) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }

  const { id } = await params;
  const orderId = String(id || "").trim();
  if (!isUuid(orderId)) {
    return NextResponse.json({ success: false, error: "Order tidak valid" }, { status: 400 });
  }

  try {
    const rows = await query<{ payment_proof_path: string | null }>(
      "SELECT payment_proof_path FROM pos.pos_orders WHERE id = $1 LIMIT 1",
      [orderId]
    );
    const relPath = rows[0]?.payment_proof_path;
    if (!isPaymentProofPathFor(orderId, relPath)) {
      return NextResponse.json({ success: false, error: "Bukti bayar belum ada" }, { status: 404 });
    }
    const { data, mime } = await readPrivateFile(relPath);
    if (!data) {
      return NextResponse.json({ success: false, error: "Berkas bukti bayar hilang" }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": mime ?? "application/octet-stream",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[pos/orders/payment-proof] GET failed:", error);
    return NextResponse.json({ success: false, error: "Gagal memuat bukti bayar" }, { status: 500 });
  }
}

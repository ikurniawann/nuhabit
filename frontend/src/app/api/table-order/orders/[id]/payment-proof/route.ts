import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { isPaymentProofPathFor, PAYMENT_PROOF_FOLDER, PAYMENT_PROOF_MAX_BYTES } from "@/lib/payments/static-qris";
import { deletePrivateFile, readPrivateFile, savePrivateImage, sniffImageMime } from "@/lib/storage-private";
import { paymentFlowFrom } from "@/lib/table-order/order-status";
import { clientIdentifier, isUuid } from "@/lib/table-order/server";

export const dynamic = "force-dynamic";

/**
 * Bukti bayar Static QRIS dari pemesan self-order.
 * - POST : unggah/ganti gambar bukti (multipart `file`) — hanya order
 *          static_qris yang masih unpaid & belum dibatalkan.
 * - GET  : tampilkan bukti (pemesan melihat kiriman sendiri).
 *
 * Akses = id order UUID acak (pola sama dgn GET status order). Berkas di
 * storage/private, bukan bucket publik; kasir melihatnya lewat
 * /api/pos/orders/[id]/payment-proof yang ber-auth POS.
 */

type ProofOrderRow = {
  id: string;
  status: string;
  payment_status: string;
  payment_method: string | null;
  special_requests: string | null;
  payment_proof_path: string | null;
};

const CLOSED_STATUSES = new Set(["cancelled", "voided", "merged"]);

function fail(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

async function loadProofOrder(orderId: string) {
  const rows = await query<ProofOrderRow>(
    `SELECT id, status::text AS status, payment_status::text AS payment_status,
            payment_method::text AS payment_method, special_requests, payment_proof_path
     FROM pos.pos_orders WHERE id = $1 LIMIT 1`,
    [orderId]
  );
  return rows[0] ?? null;
}

async function resolveOrderId(params: Promise<{ id: string }>) {
  const { id } = await params;
  const orderId = String(id || "").trim();
  return isUuid(orderId) ? orderId : null;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const orderId = await resolveOrderId(params);
  if (!orderId) return fail("Order tidak valid", 400);

  const rate = checkRateLimit(`table-order:proof:${clientIdentifier(request)}`, 10);
  if (!rate.allowed) return fail("Terlalu sering mengunggah — tunggu sebentar", 429);

  try {
    const order = await loadProofOrder(orderId);
    if (!order) return fail("Order tidak ditemukan", 404);
    if (paymentFlowFrom(order.special_requests, order.payment_method) !== "static_qris") {
      return fail("Order ini tidak memakai pembayaran Static QRIS", 409);
    }
    if (order.payment_status === "paid") return fail("Order sudah lunas", 409);
    if (CLOSED_STATUSES.has(order.status)) return fail("Order sudah dibatalkan", 409);

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File) || file.size === 0) return fail("Pilih foto bukti bayar dulu", 400);
    if (file.size > PAYMENT_PROOF_MAX_BYTES) return fail("Foto bukti maksimal 8 MB", 400);

    const buffer = Buffer.from(await file.arrayBuffer());
    // Tipe dari magic bytes; MIME klaim browser bisa kosong (sebagian galeri HP).
    const sniffed = sniffImageMime(buffer);
    if (!sniffed) return fail("File harus foto/tangkapan layar JPG, PNG, atau WebP", 400);

    const saved = await savePrivateImage(buffer, sniffed, `${PAYMENT_PROOF_FOLDER}/${orderId}`);
    if (!saved.path) return fail(saved.error || "Gagal menyimpan bukti bayar", 500);

    const updated = await query<{ payment_proof_uploaded_at: string }>(
      `UPDATE pos.pos_orders
       SET payment_proof_path = $2, payment_proof_uploaded_at = now(), updated_at = now()
       WHERE id = $1 AND payment_status::text <> 'paid'
       RETURNING payment_proof_uploaded_at`,
      [orderId, saved.path]
    );
    if (!updated[0]) {
      // Kasir melunasi di antara cek & update — buang berkas yang baru disimpan.
      await deletePrivateFile(saved.path);
      return fail("Order sudah lunas", 409);
    }
    if (isPaymentProofPathFor(orderId, order.payment_proof_path) && order.payment_proof_path !== saved.path) {
      await deletePrivateFile(order.payment_proof_path);
    }

    return NextResponse.json({
      success: true,
      data: { payment_proof_uploaded_at: updated[0].payment_proof_uploaded_at },
    });
  } catch (error) {
    console.error("[table-order] payment proof upload error:", error);
    return fail("Gagal mengunggah bukti bayar", 500);
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const orderId = await resolveOrderId(params);
  if (!orderId) return fail("Order tidak valid", 400);

  const rate = checkRateLimit(`table-order:proof-view:${clientIdentifier(request)}`, 60);
  if (!rate.allowed) return fail("Terlalu sering — tunggu sebentar", 429);

  try {
    const order = await loadProofOrder(orderId);
    if (!order || !isPaymentProofPathFor(orderId, order.payment_proof_path)) {
      return fail("Bukti bayar belum ada", 404);
    }
    const { data, mime } = await readPrivateFile(order.payment_proof_path);
    if (!data) return fail("Bukti bayar belum ada", 404);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": mime ?? "application/octet-stream",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[table-order] payment proof view error:", error);
    return fail("Gagal memuat bukti bayar", 500);
  }
}

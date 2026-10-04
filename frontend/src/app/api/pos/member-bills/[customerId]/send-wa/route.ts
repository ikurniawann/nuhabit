import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamAction } from "@/lib/api/auth";
import { queryOne } from "@/lib/db";
import { IAM } from "@/lib/iam/prefixes";
import { getMemberBillDetail, MemberBillError } from "@/lib/pos/member-bill-server";
import { buildMemberBillReminderMessage, normalizeWaPhone } from "@/lib/pos/receipt-wa";
import { checkRateLimit } from "@/lib/rate-limit";
import { isUuid } from "@/lib/table-order/server";
import { sendWhatsAppText } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

/**
 * POST /api/pos/member-bills/[customerId]/send-wa — kirim rincian tagihan ke
 * WA member (owner 2026-10-01). Body `{ preview: true }` hanya mengembalikan
 * teks + nomor tujuan tanpa mengirim (kasir melihat dulu sebelum kirim).
 * Isi pesan dimuat ULANG dari database dan nomor diambil dari profil member —
 * bukan dari klien — supaya tagihan tidak terkirim ke nomor/angka yang salah.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ customerId: string }> }) {
  let user;
  try {
    user = await requireIamAction(IAM.posMemberBills, "create");
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    throw error;
  }
  const { customerId } = await params;
  if (!isUuid(customerId)) {
    return NextResponse.json({ success: false, error: "Member tidak valid" }, { status: 400 });
  }
  const body = (await request.json().catch(() => ({}))) as { preview?: boolean };

  try {
    const detail = await getMemberBillDetail(customerId);
    if (detail.balance.outstanding <= 0) {
      return NextResponse.json({ success: false, error: "Tidak ada sisa tagihan untuk dikirim" }, { status: 400 });
    }
    const phone = normalizeWaPhone(detail.customer.phone);
    if (!phone) {
      return NextResponse.json(
        { success: false, error: "Nomor WA member tidak valid — perbarui di data member" },
        { status: 400 }
      );
    }

    const outlet = await queryOne<{ name: string }>(
      "SELECT name FROM configuration.companies ORDER BY created_at LIMIT 1"
    );
    const message = buildMemberBillReminderMessage({
      outletName: outlet?.name ?? "Kasir",
      customerName: detail.customer.name,
      at: new Date().toISOString(),
      orders: detail.open_orders.map((order) => ({
        orderNumber: order.order_number || order.id.slice(0, 8),
        orderedAt: order.ordered_at,
        total: order.total_amount,
      })),
      openTotal: detail.balance.openTotal,
      paid: detail.balance.credit,
      outstanding: detail.balance.outstanding,
    });

    if (body.preview) {
      return NextResponse.json({ success: true, data: { phone, message, sent: false } });
    }

    // Cegah dobel-kirim (klik ganda / spam) — per member & per kasir.
    if (!checkRateLimit(`pos-member-bill-wa:${customerId}`, 3).allowed ||
        !checkRateLimit(`pos-member-bill-wa-user:${user.id}`, 20).allowed) {
      return NextResponse.json(
        { success: false, error: "Tagihan baru saja dikirim — tunggu sebentar sebelum kirim lagi" },
        { status: 429 }
      );
    }

    const result = await sendWhatsAppText(
      { target: phone, message },
      { messageType: "notification", sentByUserId: user.id }
    );
    if (!result.success) {
      return NextResponse.json({ success: false, error: result.reason ?? "Gagal mengirim WA" }, { status: 502 });
    }
    return NextResponse.json({ success: true, data: { phone, message, sent: true } });
  } catch (error) {
    if (error instanceof MemberBillError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error("[member-bills] send-wa:", error);
    return NextResponse.json({ success: false, error: "Gagal mengirim tagihan" }, { status: 500 });
  }
}

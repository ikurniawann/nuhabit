import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePosMenu } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { scanMemberQr } from "@/lib/crm/engagement/server";
import { QR_PROBLEM_LABEL } from "@/lib/crm/engagement/rules";
import { withTransaction } from "@/lib/db";
import { checkInBooking, type GymCheckInResult } from "@/lib/gym/booking-server";

const scanSchema = z.object({ token: z.string().trim().min(8).max(120) });

/**
 * POST /api/pos/member-qr — kasir memindai QR kartu member. Berhasil:
 * customer untuk dipasang ke order. Ditolak: alasan yang bisa dibacakan.
 * Scan yang sama juga menjadi check-in kelas gym: bila member punya booking
 * terkonfirmasi di sekitar sekarang, ia di-check-in dan kreditnya dipotong.
 * `gym` menjelaskan keputusannya (mis. "Tidak ada booking kelas"); pesanan
 * kasir tetap jalan apa pun keputusannya.
 */
export async function POST(request: Request) {
  const pos = await requirePosMenu(IAM.posOperations);
  if (pos.error) return pos.error;
  const parsed = scanSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "QR tidak valid" }, { status: 400 });
  }
  try {
    const result = await scanMemberQr(parsed.data.token, pos.userId);
    if (!result.ok) {
      return NextResponse.json({ success: false, error: QR_PROBLEM_LABEL[result.problem] }, { status: 409 });
    }
    const gym = await withTransaction((client) =>
      checkInBooking(client, { customerId: result.customerId, scannedBy: pos.userId, source: "pos" })
    ).catch((error): GymCheckInResult | null => {
      console.error("[pos/member-qr] gym check-in failed:", error);
      return null;
    });
    return NextResponse.json({
      success: true,
      data: { customer_id: result.customerId, name: result.name, phone: result.phone, gym },
    });
  } catch (error) {
    console.error("[pos/member-qr] scan failed:", error);
    return NextResponse.json({ success: false, error: "Gagal memeriksa QR" }, { status: 500 });
  }
}

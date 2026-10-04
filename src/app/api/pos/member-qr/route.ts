import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requirePosMenu } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { scanMemberQr } from "@/lib/crm/engagement/server";
import { QR_PROBLEM_LABEL } from "@/lib/crm/engagement/rules";
import { withTransaction } from "@/lib/db";
import { checkInBooking, type GymCheckInResult } from "@/lib/gym/booking-server";
import { parseJsonBody } from "@/lib/pos/route-guards";

const scanSchema = z.object({ token: z.string().trim().min(8).max(120) });

/**
 * POST /api/pos/member-qr — kasir memindai QR kartu member. Berhasil:
 * customer untuk dipasang ke order. Ditolak: alasan yang bisa dibacakan.
 * Scan yang sama juga menjadi check-in kelas gym: bila member punya booking
 * terkonfirmasi di sekitar sekarang, ia di-check-in dan kreditnya dipotong.
 * `gym` menjelaskan keputusannya (mis. "Tidak ada booking kelas"); pesanan
 * kasir tetap jalan apa pun keputusannya.
 */
export const POST = apiHandler(async (request: Request) => {
  const pos = await requirePosMenu(IAM.posOperations);
  if (pos.error) return pos.error;
  const { token } = await parseJsonBody(request, scanSchema, "QR tidak valid");

  const result = await scanMemberQr(token, pos.userId);
  if (!result.ok) throw ApiError.conflict(QR_PROBLEM_LABEL[result.problem]);

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
}, "pos/member-qr");

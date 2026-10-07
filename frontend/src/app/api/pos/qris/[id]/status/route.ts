import { NextRequest, NextResponse } from "next/server";
import { getPosSession } from "@/lib/api/auth";
import { createPgClient } from "@/lib/pg/create-client";
import {
  getXenditQrCode,
  getXenditQrPayments,
  isXenditQrPaid,
  loadActiveXenditConfig,
} from "@/lib/payments/xendit";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

function isGatewayConfigError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /not configured|inactive|secret key is missing/i.test(message);
}

// GET /api/pos/qris/[id]/status — poll Xendit sampai QRIS lunas
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }

  try {
    const { id } = await context.params;
    const qrId = String(id || "").trim();
    if (!qrId || qrId.length > 128) {
      return NextResponse.json({ success: false, error: "QR tidak valid" }, { status: 400 });
    }

    const db = createPgClient();
    let xendit;
    try {
      xendit = await loadActiveXenditConfig(db);
    } catch (err) {
      const message = err instanceof Error ? err.message : "QRIS belum dikonfigurasi";
      if (isGatewayConfigError(err)) {
        return NextResponse.json({ success: false, error: message }, { status: 503 });
      }
      throw err;
    }

    const remote = await getXenditQrCode(xendit.secretKey, qrId);
    let paid = isXenditQrPaid(remote);
    let status = String(remote.status || remote.payment_status || "ACTIVE");

    if (!paid) {
      try {
        const payments = await getXenditQrPayments(xendit.secretKey, qrId);
        if (isXenditQrPaid({ payments })) {
          paid = true;
          const paidRow = payments.find((row) =>
            isXenditQrPaid({ status: String(row.status || "") })
          );
          status = String(paidRow?.status || "SUCCEEDED");
        }
      } catch {
        // QR detail sudah cukup; payments endpoint opsional
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        qr_id: String(remote.id || qrId),
        paid,
        status,
      },
    });
  } catch (error: unknown) {
    console.error("[pos] qris status error:", getErrorMessage(error));
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 502 }
    );
  }
}

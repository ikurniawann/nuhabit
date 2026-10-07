import { NextRequest } from "next/server";
import { noContentResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { softDeleteDealPayment } from "@/lib/finance/invoices";
import { requireFinanceUser } from "@/lib/finance/server";

/**
 * EPIC-025 — hapus (soft) catatan pembayaran dari modul Finance:
 * koreksi salah catat, jejak tetap (deleted_at + deleted_by).
 */
export const DELETE = apiHandler(
  async (_request: NextRequest, { params }: { params: Promise<{ paymentId: string }> }) => {
    const user = await requireFinanceUser();
    const { paymentId } = await params;
    await softDeleteDealPayment(paymentId, user);
    return noContentResponse();
  },
  "DELETE /api/finance/payments/[paymentId]"
);

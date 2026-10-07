import { NextRequest } from "next/server";
import { noContentResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { requireFinanceRole } from "@/lib/finance/server";
import { requireAccessibleDeal } from "@/lib/sales-funnel/access";
import { deletePayment } from "@/lib/sales-funnel/billing-server";

type Params = { params: Promise<{ id: string; paymentId: string }> };

/** Hapus (soft) catatan pembayaran — koreksi salah catat, wewenang finance (EPIC-025 Opsi B). */
export const DELETE = apiHandler(async (_request: NextRequest, { params }: Params) => {
  const { error, user } = await requireFinanceRole();
  if (error) return error;
  const { id, paymentId } = await params;
  await requireAccessibleDeal(id, user);
  await deletePayment(id, paymentId, user.id);
  return noContentResponse();
}, "sales-funnel.deals.payments.DELETE");

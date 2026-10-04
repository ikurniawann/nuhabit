import { NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";

const AP_PAYMENTS_PATH = "/dashboard/accounting/accounts-payable/payments";

/**
 * Deprecated: pembayaran vendor pindah ke Accounting AP Payment.
 * `recordApPayment` tetap dual-write untuk tampilan outstanding PO.
 */
export const POST = apiHandler(async () => {
  await requireIamMenuPrefix(IAM.items);
  return NextResponse.json(
    {
      success: false,
      error: `Pembayaran vendor dipindah ke Accounting → Accounts Payable → Payment. Gunakan ${AP_PAYMENTS_PATH}`,
      redirect: AP_PAYMENTS_PATH,
    },
    { status: 410 }
  );
}, "purchasing.po.payments");

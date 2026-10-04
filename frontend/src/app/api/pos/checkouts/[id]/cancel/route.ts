import { NextRequest, NextResponse } from "next/server";
import { getPosSession } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import {
  MixedCheckoutError,
  cancelUnpaidChildlessCheckout,
} from "@/lib/pos/create-mixed-checkout";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }

  try {
    const { id } = await context.params;
    const checkoutId = String(id || "").trim();
    if (!checkoutId) {
      return NextResponse.json({ success: false, error: "Checkout tidak valid" }, { status: 400 });
    }

    const scope = await getApiUserScope();
    const result = await cancelUnpaidChildlessCheckout(checkoutId, {
      companyId: scope?.isUnscoped ? null : scope?.companyId,
      branchId: scope?.isUnscoped ? null : scope?.branchId,
    });
    return NextResponse.json({
      success: true,
      data: { checkout_id: result.checkoutId },
    });
  } catch (error: unknown) {
    if (error instanceof MixedCheckoutError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: error.status }
      );
    }
    console.error("[pos] cancel checkout error:", error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { findMembersByPhone } from "@/lib/giftcard/giftcard-server";
import { requirePromoContext } from "@/lib/giftcard/server";

// Cari member per nomor HP utk menautkan gift card (min 6 digit).
export async function GET(request: NextRequest) {
  const { error } = await requirePromoContext();
  if (error) return error;

  try {
    const phone = request.nextUrl.searchParams.get("phone") ?? "";
    return successResponse(await findMembersByPhone(phone));
  } catch (err) {
    console.error("[giftcard] member lookup error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal mencari member" },
      { status: 500 }
    );
  }
}

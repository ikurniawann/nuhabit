import { NextRequest, NextResponse } from "next/server";
import { requirePosMenu } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { loadGobizConfig, isGobizConfigured } from "@/lib/gobiz/config";
import { listGofoodOrders } from "@/lib/gobiz/service";

export const dynamic = "force-dynamic";

/** GET /api/pos/gofood/orders?status=active|<status>&limit=50 — daftar order GoFood utk halaman kasir. */
export async function GET(request: NextRequest) {
  const pos = await requirePosMenu(IAM.posOperations);
  if (pos.error) return pos.error;

  try {
    const status = request.nextUrl.searchParams.get("status") || "active";
    const limit = Number(request.nextUrl.searchParams.get("limit") || 50);
    const [orders, config] = await Promise.all([listGofoodOrders({ status, limit }), loadGobizConfig()]);
    return NextResponse.json({
      success: true,
      data: orders,
      meta: {
        configured: isGobizConfigured(config),
        enabled: config.enabled,
        auto_accept: config.autoAccept,
        environment: config.environment,
      },
    });
  } catch (error) {
    console.error("[pos/gofood] list failed:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Gagal memuat order GoFood" },
      { status: 500 }
    );
  }
}

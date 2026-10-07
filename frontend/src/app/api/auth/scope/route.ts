import { NextResponse } from "next/server";
import { getApiUserScope } from "@/lib/api/scope";

export async function GET() {
  try {
    const scope = await getApiUserScope();
    if (!scope) {
      return NextResponse.json(
        { success: false, message: "Not authenticated" },
        { status: 401 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        role: scope.role,
        business_scope: scope.businessScope,
        branch_id: scope.branchId,
        company_id: scope.companyId,
        holding_id: scope.holdingId,
        is_unscoped: scope.isUnscoped,
      },
    });
  } catch (error: unknown) {
    console.error("Error fetching user scope:", error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Failed to fetch user scope",
      },
      { status: 500 }
    );
  }
}

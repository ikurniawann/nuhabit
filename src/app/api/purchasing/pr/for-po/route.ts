import { createServerPgClient } from "@/lib/pg/create-client";
import { requireUser } from "@/lib/auth/require-user";
import { NextRequest, NextResponse } from "next/server";
import {
  getApiUserScope,
  isRowInBusinessScope,
} from "@/lib/api/scope";

type PRRow = {
  id: string;
  requester_id: string;
  department_id?: string | null;
  company_id?: string | null;
  branch_id?: string | null;
  items?: unknown[];
  [key: string]: unknown;
};

function resolvePrScope(
  pr: PRRow,
  requesterById: Map<string, { company_id?: string | null; branch_id?: string | null }>
) {
  const requester = requesterById.get(pr.requester_id);
  return {
    company_id: pr.company_id ?? requester?.company_id ?? null,
    branch_id: pr.branch_id ?? requester?.branch_id ?? null,
  };
}

/**
 * PR yang eligible untuk dibuat PO:
 * - status approved
 * - belum punya converted_po_id
 * - belum terhubung ke PO aktif lain
 * - dalam scope bisnis user (dengan fallback scope dari requester)
 */
export async function GET(request: NextRequest) {
  try {
    const db = await createServerPgClient();
    await requireUser();
    const scope = await getApiUserScope();
    const moduleType = new URL(request.url).searchParams.get("module_type") || "raw_material";

    const query = db
      .from("purchase_requests")
      .select(
        `
        *,
        items:pr_items(*)
      `
      )
      .eq("status", "approved")
      .eq("module_type", moduleType)
      .is("converted_po_id", null)
      .order("created_at", { ascending: false })
      .limit(200);

    const { data: prs, error } = await query;

    if (error) throw error;

    const requesterIds = [
      ...new Set((prs || []).map((pr) => pr.requester_id).filter(Boolean)),
    ];
    const { data: requesterProfiles } = requesterIds.length
      ? await db
          .from("users")
          .select("id, full_name, company_id, branch_id")
          .in("id", requesterIds)
      : { data: [] };

    const requesterById = new Map(
      (requesterProfiles || []).map((requester) => [requester.id, requester])
    );

    const scopedPrs = ((prs || []) as PRRow[]).filter((pr) => {
      if (!scope || scope.isUnscoped) return true;
      return isRowInBusinessScope(scope, resolvePrScope(pr, requesterById));
    });

    const { data: linkedPos, error: poError } = await db
      .from("purchase_orders")
      .select("pr_id")
      .not("pr_id", "is", null)
      .eq("is_active", true);

    if (poError) throw poError;

    const linkedPrIds = new Set(
      (linkedPos || []).map((po) => po.pr_id).filter(Boolean) as string[]
    );

    const eligiblePrs = scopedPrs.filter((pr) => !linkedPrIds.has(pr.id));

    const departmentIds = [
      ...new Set(eligiblePrs.map((pr) => pr.department_id).filter(Boolean)),
    ];
    const { data: departments } = departmentIds.length
      ? await db.from("departments").select("id, name").in("id", departmentIds)
      : { data: [] };
    const departmentById = new Map(
      (departments || []).map((department) => [department.id, department.name])
    );

    const mapped = eligiblePrs.map((pr) => ({
      ...pr,
      department_name: departmentById.get(pr.department_id) || null,
      requester_name: requesterById.get(pr.requester_id)?.full_name || null,
    }));

    return NextResponse.json({ data: mapped });
  } catch (error) {
    console.error("Error fetching PR for PO:", error);
    return NextResponse.json(
      { error: "Gagal mengambil daftar PR untuk PO" },
      { status: 500 }
    );
  }
}

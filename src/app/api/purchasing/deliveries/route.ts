import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { branchScopeOr, companyScopeOr, getApiUserScope } from "@/lib/api/scope";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";

/**
 * Route lama. Alur aktif ada di /api/purchasing/delivery;
 * body POST diteruskan apa adanya ke tabel deliveries.
 */
const LEGACY_DELIVERY_SELECT = `
  *,
  po:nomor_po,status,
  supplier:supplier_id(id,kode,nama_supplier)
`;

const createLegacyDeliverySchema = z.looseObject({ po_id: z.string() });

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const db = await createServerPgClient();
  const { searchParams } = new URL(request.url);
  const poId = searchParams.get("po_id");
  const status = searchParams.get("status");

  let query = db
    .from("deliveries")
    .select(LEGACY_DELIVERY_SELECT, { count: "exact" })
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  const scope = await getApiUserScope();
  const companyOr = companyScopeOr(scope);
  if (companyOr) query = query.or(companyOr);
  const branchOr = branchScopeOr(scope);
  if (branchOr) query = query.or(branchOr);

  if (poId) query = query.eq("po_id", poId);
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) throw error;

  return NextResponse.json({ data: data || [] });
}, "purchasing.deliveries.list");

export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const body = await validateBody(request, createLegacyDeliverySchema);
  const db = await createServerPgClient();

  // Delivery mewarisi supplier + scope (company/branch) dari PO.
  const { data: po } = await db
    .from("purchase_orders")
    .select("supplier_id, company_id, branch_id")
    .eq("id", body.po_id)
    .single();
  if (!po) throw ApiError.notFound("Purchase order not found");

  const { data, error } = await db
    .from("deliveries")
    .insert({
      ...body,
      supplier_id: po.supplier_id,
      company_id: po.company_id ?? null,
      branch_id: po.branch_id ?? null,
      status: "IN_TRANSIT",
    })
    .select(LEGACY_DELIVERY_SELECT)
    .single();
  if (error) throw error;

  return NextResponse.json({ data });
}, "purchasing.deliveries.create");

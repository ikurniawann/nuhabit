import { NextRequest, NextResponse } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import { requireUser } from "@/lib/auth/require-user";
import {
  getApiUserScope,
  companyScopeOr,
  branchScopeOr,
} from "@/lib/api/scope";

const CREATE_PR_ROLES = [
  "purchasing_staff",
  "purchasing_manager",
  "purchasing_admin",
  "super_admin",
  "admin",
  "pos_supervisor",
  "hrd",
];

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    if (!CREATE_PR_ROLES.includes(user.role)) {
      return NextResponse.json(
        { error: "Anda tidak memiliki akses untuk membuat PR" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const moduleType = searchParams.get("module_type") || "raw_material";

    const db = await createServerPgClient();
    const scope = await getApiUserScope();

    const { data: departments } = await db
      .from("departments")
      .select("id, name")
      .eq("is_active", true)
      .order("name");

    if (moduleType === "product") {
      let productsQuery = db
        .from("v_products_cogs")
        .select("id, kode, nama, satuan_id, satuan_nama, harga_modal")
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("nama");

      const companyOr = companyScopeOr(scope);
      if (companyOr) productsQuery = productsQuery.or(companyOr);
      const branchOr = branchScopeOr(scope);
      if (branchOr) productsQuery = productsQuery.or(branchOr);

      const [{ data: products }, { data: units }] = await Promise.all([
        productsQuery,
        db.from("units").select("id, nama").eq("is_active", true).order("nama"),
      ]);

      return NextResponse.json({
        data: {
          departments: departments || [],
          products: products || [],
          units: units || [],
        },
      });
    }

    if (moduleType === "general") {
      // EPIC-026 B2 — sumber item PR barang operasional = item.supply_items.
      let supplyQuery = db
        .from("supply_items")
        .select("id, kode, nama, satuan_id, stockable, harga_beli")
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("nama");

      const companyOr = companyScopeOr(scope);
      if (companyOr) supplyQuery = supplyQuery.or(companyOr);
      const branchOr = branchScopeOr(scope);
      if (branchOr) supplyQuery = supplyQuery.or(branchOr);

      const [{ data: supplies }, { data: units }] = await Promise.all([
        supplyQuery,
        db.from("units").select("id, nama").eq("is_active", true).order("nama"),
      ]);

      return NextResponse.json({
        data: {
          departments: departments || [],
          supplies: supplies || [],
          units: units || [],
        },
      });
    }

    const [{ data: materials }, { data: units }] = await Promise.all([
      db
        .from("v_raw_materials_stock")
        .select("id, kode, nama, satuan_besar_id, satuan_besar_nama, satuan_kecil_id, konversi_factor, avg_cost")
        .eq("is_active", true)
        .order("nama"),
      db.from("units").select("id, nama").eq("is_active", true).order("nama"),
    ]);

    const materialIds = (materials || []).map((material) => material.id);
    const { data: conversions } = materialIds.length
      ? await db
          .from("raw_material_unit_conversions")
          .select("raw_material_id, satuan_id, qty_in_base_unit, is_base, is_purchase_default, is_active")
          .in("raw_material_id", materialIds)
          .eq("is_active", true)
      : { data: [] };

    const conversionsByMaterial = new Map<string, NonNullable<typeof conversions>>();
    for (const conversion of conversions || []) {
      const current = conversionsByMaterial.get(conversion.raw_material_id) || [];
      current.push(conversion);
      conversionsByMaterial.set(conversion.raw_material_id, current);
    }

    const materialsWithConversions = (materials || []).map((material) => ({
      ...material,
      unit_conversions: conversionsByMaterial.get(material.id) || [],
    }));

    return NextResponse.json({
      data: {
        departments: departments || [],
        materials: materialsWithConversions,
        units: units || [],
      },
    });
  } catch (error) {
    console.error("Error fetching PR form data:", error);
    return NextResponse.json({ error: "Gagal memuat data form PR" }, { status: 500 });
  }
}

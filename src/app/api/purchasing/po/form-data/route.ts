import { NextRequest, NextResponse } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import {
  getApiUserScope,
  companyScopeOr,
  branchScopeOr,
} from "@/lib/api/scope";

// EPIC-047 Fase 2 — SKU merchandise aktif dilampirkan per produk di form PO.
type PoFormSkuRow = {
  id: string;
  product_id: string;
  sku: string;
  name: string;
  options?: Record<string, string> | null;
  stock_quantity?: number | null;
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const moduleType = searchParams.get("module_type") || "raw_material";
    const db = await createServerPgClient();
    const scope = await getApiUserScope();

    if (moduleType === "product") {
      // PO produk/F&B: hanya vendor ber-peruntukan 'fnb' atau 'keduanya'.
      let vendorsQuery = db
        .from("vendors")
        .select("id, code, name")
        .eq("is_active", true)
        .in("usage_scope", ["fnb", "keduanya"])
        .order("name");

      const companyOr = companyScopeOr(scope);
      if (companyOr) vendorsQuery = vendorsQuery.or(companyOr);
      const branchOr = branchScopeOr(scope);
      if (branchOr) vendorsQuery = vendorsQuery.or(branchOr);

      let productsQuery = db
        .from("v_products_cogs")
        .select("id, kode, nama, satuan_id, satuan_nama, harga_modal")
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("nama");

      if (companyOr) productsQuery = productsQuery.or(companyOr);
      if (branchOr) productsQuery = productsQuery.or(branchOr);

      const [{ data: vendors }, { data: products }, { data: units }] = await Promise.all([
        vendorsQuery,
        productsQuery,
        db.from("units").select("id, nama, kode").eq("is_active", true).order("nama"),
      ]);

      // EPIC-047 Fase 2 — lampirkan SKU merchandise aktif per produk (kosong
      // untuk produk tanpa varian) supaya form PO produk bisa menampilkan
      // baris per SKU untuk produk ber-varian.
      type PoFormProductRow = { id: string; [key: string]: unknown };
      const typedProducts = (products || []) as PoFormProductRow[];
      const productIds = typedProducts.map((p) => p.id);
      const { data: posProducts } = productIds.length
        ? await db
            .from("pos_products")
            .select("id, source_product_id")
            .eq("product_kind", "merchandise")
            .in("source_product_id", productIds)
        : { data: [] };

      type PosProductRow = { id: string; source_product_id: string };
      const typedPosProducts = (posProducts || []) as PosProductRow[];
      const posProductIdByProductId = new Map(
        typedPosProducts.map((p) => [p.source_product_id, p.id])
      );
      const posProductIds = typedPosProducts.map((p) => p.id);

      const { data: skuRows } = posProductIds.length
        ? await db
            .from("pos_product_skus")
            .select("id, product_id, sku, name, options, stock_quantity")
            .eq("is_active", true)
            .in("product_id", posProductIds)
            .order("name")
        : { data: [] as PoFormSkuRow[] };

      const skusByPosProductId = new Map<string, PoFormSkuRow[]>();
      for (const row of (skuRows || []) as PoFormSkuRow[]) {
        const list = skusByPosProductId.get(row.product_id) || [];
        list.push(row);
        skusByPosProductId.set(row.product_id, list);
      }

      const productsWithSkus = typedProducts.map((product) => {
        const posProductId = posProductIdByProductId.get(product.id);
        const skus = posProductId ? skusByPosProductId.get(posProductId) || [] : [];
        return { ...product, pos_skus: skus };
      });

      return NextResponse.json({
        success: true,
        data: {
          vendors: vendors || [],
          products: productsWithSkus,
          units: units || [],
        },
      });
    }

    if (moduleType === "general") {
      // EPIC-026 B3 — PO barang operasional: pemasok REUSE tabel `vendors`,
      // sumber item = item.supply_items (harga_beli sbagai harga default).
      // Hanya vendor ber-peruntukan 'operasional' atau 'keduanya'.
      let vendorsQuery = db
        .from("vendors")
        .select("id, code, name")
        .eq("is_active", true)
        .in("usage_scope", ["operasional", "keduanya"])
        .order("name");

      const companyOr = companyScopeOr(scope);
      if (companyOr) vendorsQuery = vendorsQuery.or(companyOr);
      const branchOr = branchScopeOr(scope);
      if (branchOr) vendorsQuery = vendorsQuery.or(branchOr);

      let suppliesQuery = db
        .from("supply_items")
        .select("id, kode, nama, satuan_id, stockable, harga_beli")
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("nama");

      if (companyOr) suppliesQuery = suppliesQuery.or(companyOr);
      if (branchOr) suppliesQuery = suppliesQuery.or(branchOr);

      const [{ data: vendors }, { data: supplies }, { data: units }] = await Promise.all([
        vendorsQuery,
        suppliesQuery,
        db.from("units").select("id, nama, kode").eq("is_active", true).order("nama"),
      ]);

      return NextResponse.json({
        success: true,
        data: {
          vendors: vendors || [],
          supplies: supplies || [],
          units: units || [],
        },
      });
    }

    const [{ data: suppliers }, { data: materials }, { data: units }] = await Promise.all([
      db.from("suppliers").select("id, kode, nama_supplier").eq("is_active", true).order("nama_supplier"),
      db
        .from("v_raw_materials_stock")
        .select("id, kode, nama, satuan_besar_id, satuan_besar_nama, satuan_kecil_id, konversi_factor, avg_cost")
        .eq("is_active", true)
        .order("nama"),
      db.from("units").select("id, nama, kode").eq("is_active", true).order("nama"),
    ]);

    // Pack per bahan baku: baris PO baru memakai pack beli bawaan.
    const materialRows = (materials || []) as { id: string }[];
    const materialIds = materialRows.map((material) => material.id);
    const { data: packs } = materialIds.length
      ? await db
          .from("raw_material_unit_conversions")
          .select("raw_material_id, satuan_id, qty_in_base_unit, is_base, is_purchase_default, is_active")
          .in("raw_material_id", materialIds)
          .eq("is_active", true)
      : { data: [] };
    const packsByMaterial = new Map<string, NonNullable<typeof packs>>();
    for (const pack of packs || []) {
      packsByMaterial.set(pack.raw_material_id, [...(packsByMaterial.get(pack.raw_material_id) || []), pack]);
    }

    return NextResponse.json({
      success: true,
      data: {
        suppliers: suppliers || [],
        materials: materialRows.map((material) => ({
          ...material,
          unit_conversions: packsByMaterial.get(material.id) || [],
        })),
        units: units || [],
      },
    });
  } catch (error) {
    console.error("Error fetching PO form data:", error);
    return NextResponse.json({ success: false, message: "Failed to load PO form data" }, { status: 500 });
  }
}

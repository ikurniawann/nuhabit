import { NextResponse } from "next/server";
import { createPgClient } from "@/lib/pg/create-client";
import { getPosSession } from "@/lib/api/auth";
import type {
  ProductAtRiskAlert,
  ProductIngredientAlert,
  RawMaterialAlert,
  PosProductStockAlert,
  StockAlertLevel,
  StockAlertsResponse,
} from "@/lib/pos/stock-alerts-types";

type RawMaterialRow = {
  id: string;
  kode?: string | null;
  nama?: string | null;
  kategori?: string | null;
  qty_onhand?: number | string | null;
  min_stock?: number | string | null;
  satuan?: string | null;
  status_stok?: string | null;
};

type BomRow = {
  product_id: string;
  raw_material_id: string;
  qty_required?: number | string | null;
  waste_factor?: number | string | null;
  product?: { id: string; kode?: string | null; nama?: string | null; is_active?: boolean | null } | null;
  raw_material?: { id: string; kode?: string | null; nama?: string | null } | null;
};

type PosProductRow = {
  id: string;
  sku?: string | null;
  name?: string | null;
  inventory_quantity?: number | string | null;
  inventory_min_stock?: number | string | null;
  inventory_tracking?: boolean | null;
};

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function alertLevelFromStock(qty: number, min: number, status?: string | null): StockAlertLevel {
  if (qty <= 0 || status === "HABIS") return "critical";
  return "warning";
}

function formatQty(value: number) {
  return Math.round(value * 100) / 100;
}

async function loadPosProductStockAlerts(
  db: ReturnType<typeof createPgClient>
): Promise<PosProductStockAlert[]> {
  const { data, error } = await db
    .from("pos_products")
    .select("id, sku, name, inventory_quantity, inventory_min_stock")
    .eq("is_active", true)
    .eq("inventory_tracking", true);

  if (error) {
    // Columns from legacy migration 010 may not be applied yet — skip POS direct stock.
    if (error.code === "42703") return [];
    throw error;
  }

  return ((data || []) as PosProductRow[])
    .map((item) => {
      const current = toNumber(item.inventory_quantity);
      const min = toNumber(item.inventory_min_stock);
      if (min <= 0 || current > min) return null;
      return {
        id: item.id,
        sku: item.sku || "",
        name: item.name || "",
        current,
        min,
        alert_level: current <= 0 ? ("critical" as const) : ("warning" as const),
      };
    })
    .filter((item): item is PosProductStockAlert => item !== null)
    .sort((a, b) => a.current - b.current);
}

function buildProductsAtRisk(
  bomItems: BomRow[],
  stockByMaterialId: Map<string, RawMaterialRow>
): ProductAtRiskAlert[] {
  const byProduct = new Map<
    string,
    {
      kode: string;
      nama: string;
      ingredients: ProductIngredientAlert[];
    }
  >();

  for (const bom of bomItems) {
    if (!bom.product?.is_active) continue;

    const qtyRequired = toNumber(bom.qty_required);
    if (qtyRequired <= 0) continue;

    const stock = stockByMaterialId.get(bom.raw_material_id);
    const qtyAvailable = toNumber(stock?.qty_onhand);
    const effectiveQty = qtyRequired * (1 + toNumber(bom.waste_factor));
    const coverage = effectiveQty > 0 ? qtyAvailable / effectiveQty : 0;
    const isLow =
      stock?.status_stok === "HABIS" ||
      stock?.status_stok === "MENIPIS" ||
      qtyAvailable < effectiveQty * 10;

    if (!isLow) continue;

    const entry = byProduct.get(bom.product_id) ?? {
      kode: bom.product?.kode || "",
      nama: bom.product?.nama || "",
      ingredients: [],
    };

    entry.ingredients.push({
      material_id: bom.raw_material_id,
      material_name: bom.raw_material?.nama || stock?.nama || "Bahan",
      qty_available: formatQty(qtyAvailable),
      required_per_unit: formatQty(qtyRequired),
      stock_coverage_units: formatQty(coverage),
      alert_level: alertLevelFromStock(qtyAvailable, toNumber(stock?.min_stock), stock?.status_stok),
    });

    byProduct.set(bom.product_id, entry);
  }

  const results: ProductAtRiskAlert[] = [];

  for (const [productId, product] of byProduct.entries()) {
    const sorted = [...product.ingredients].sort(
      (a, b) => a.stock_coverage_units - b.stock_coverage_units
    );
    const limiting = sorted[0];
    if (!limiting) continue;

    const maxServings = Math.floor(limiting.stock_coverage_units);
    const hasCritical = sorted.some((item) => item.alert_level === "critical");

    results.push({
      product_id: productId,
      kode: product.kode,
      nama: product.nama,
      max_servings: Math.max(0, maxServings),
      limiting_ingredient: limiting.material_name,
      ingredients: sorted,
      alert_level: hasCritical ? "critical" : "warning",
    });
  }

  return results.sort((a, b) => a.max_servings - b.max_servings);
}

export async function GET() {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }

  try {
    const db = createPgClient();

    const [{ data: rawMaterialRows, error: rawError }, { data: bomRows, error: bomError }] =
      await Promise.all([
        db
          .from("v_raw_materials_stock")
          .select("id, kode, nama, kategori, qty_onhand, min_stock, satuan, status_stok")
          .in("status_stok", ["MENIPIS", "HABIS"])
          .eq("is_active", true)
          .order("qty_onhand", { ascending: true })
          .limit(100),
        db
          .from("bom_items")
          .select(`
            product_id,
            raw_material_id,
            qty_required,
            waste_factor,
            product:products!product_id(id, kode, nama, is_active),
            raw_material:raw_materials!raw_material_id(id, kode, nama)
          `)
          .eq("is_active", true),
      ]);

    if (rawError) throw rawError;
    if (bomError) throw bomError;

    const posProducts = await loadPosProductStockAlerts(db);

    const rawMaterials: RawMaterialAlert[] = ((rawMaterialRows || []) as RawMaterialRow[]).map((item) => {
      const qty = toNumber(item.qty_onhand);
      const min = toNumber(item.min_stock);
      return {
        id: item.id,
        kode: item.kode || "",
        nama: item.nama || "",
        kategori: item.kategori || "Uncategorized",
        qty_onhand: qty,
        min_stock: min,
        satuan: item.satuan || "unit",
        status_stok: item.status_stok || "MENIPIS",
        alert_level: alertLevelFromStock(qty, min, item.status_stok),
      };
    });

    const materialIds = Array.from(
      new Set(((bomRows || []) as BomRow[]).map((row) => row.raw_material_id).filter(Boolean))
    );

    const { data: stockRows, error: stockError } =
      materialIds.length > 0
        ? await db
            .from("v_raw_materials_stock")
            .select("id, kode, nama, qty_onhand, min_stock, satuan, status_stok")
            .in("id", materialIds)
        : { data: [], error: null };

    if (stockError) throw stockError;

    const stockByMaterialId = new Map<string, RawMaterialRow>(
      ((stockRows || []) as RawMaterialRow[]).map((row) => [row.id, row])
    );

    const productsAtRisk = buildProductsAtRisk((bomRows || []) as BomRow[], stockByMaterialId);

    const payload: StockAlertsResponse = {
      raw_materials: rawMaterials,
      products_at_risk: productsAtRisk,
      pos_products: posProducts,
      summary: {
        raw_material_count: rawMaterials.length,
        product_at_risk_count: productsAtRisk.length,
        pos_product_count: posProducts.length,
      },
      updated_at: new Date().toISOString(),
    };

    return NextResponse.json({ success: true, data: payload });
  } catch (error: unknown) {
    console.error("[pos/stock-alerts]", error);
    const message = error instanceof Error ? error.message : "Failed to fetch stock alerts";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

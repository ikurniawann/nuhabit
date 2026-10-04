import type { DbClient } from "@/lib/pg/types";

/**
 * Histori harga beli supplier diturunkan dari barang yang benar-benar diterima
 * (GRN → inventory_movements), bukan dari daftar harga. Biaya per satuan dasar bahan.
 */

export type GrnRow = { id: string; nomor_grn: string | null; tanggal_penerimaan: string | null };

export type MovementRow = {
  id: string;
  raw_material_id: string;
  jumlah: number | null;
  unit_cost: number | null;
  reference_id: string | null;
  reference_number: string | null;
  created_at: string;
};

type MaterialRow = {
  id: string;
  nama: string | null;
  satuan_besar_id: string | null;
  satuan_kecil_id: string | null;
};

const SCAN_LIMIT = 1000;

export type PriceHistoryContext = {
  supplierId: string;
  supplierName: string;
  grnById: Map<string, GrnRow>;
  materialById: Map<string, MaterialRow>;
  unitNameById: Map<string, string | null>;
};

/**
 * Baris histori terbaru dulu. Tiap penerimaan dibandingkan dengan harga
 * penerimaan sebelumnya untuk bahan yang sama (`price_change_percent`).
 */
export function buildPriceHistory(movements: MovementRow[], ctx: PriceHistoryContext) {
  const ascending = [...movements].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  const lastPriceByMaterial = new Map<string, number>();

  const rows = ascending.map((movement) => {
    const material = ctx.materialById.get(movement.raw_material_id);
    const grn = movement.reference_id ? ctx.grnById.get(movement.reference_id) : undefined;
    const harga = Number(movement.unit_cost || 0);
    const previousPrice = lastPriceByMaterial.get(movement.raw_material_id) ?? null;
    lastPriceByMaterial.set(movement.raw_material_id, harga);
    const baseUnitId = material?.satuan_kecil_id || material?.satuan_besar_id || null;

    return {
      id: movement.id,
      supplier_id: ctx.supplierId,
      nama_supplier: ctx.supplierName,
      bahan_baku_id: movement.raw_material_id,
      bahan_baku_nama: material?.nama || "-",
      harga,
      qty: Number(movement.jumlah || 0),
      satuan_nama: (baseUnitId ? ctx.unitNameById.get(baseUnitId) : null) || "",
      tanggal: grn?.tanggal_penerimaan || movement.created_at,
      reference_number: movement.reference_number || grn?.nomor_grn || null,
      previous_price: previousPrice,
      price_change_percent:
        previousPrice && previousPrice > 0 ? ((harga - previousPrice) / previousPrice) * 100 : null,
    };
  });

  return rows.reverse();
}

export async function getSupplierPriceHistory(
  db: DbClient,
  supplierId: string,
  params: { materialId: string | null; months: number; page: number; limit: number }
) {
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - params.months);
  const emptyPage = { page: params.page, limit: params.limit, total: 0, total_pages: 0 };

  const { data: grnRows, error: grnError } = await db
    .from("grn")
    .select("id, nomor_grn, tanggal_penerimaan")
    .eq("supplier_id", supplierId)
    .gte("tanggal_penerimaan", startDate.toISOString().split("T")[0])
    .order("tanggal_penerimaan", { ascending: false })
    .limit(SCAN_LIMIT);
  if (grnError) throw grnError;

  const grns = (grnRows ?? []) as GrnRow[];
  if (grns.length === 0) return { data: [], pagination: emptyPage };
  const grnById = new Map(grns.map((grn) => [grn.id, grn]));

  let movementQuery = db
    .from("inventory_movements")
    .select("id, raw_material_id, jumlah, unit_cost, reference_id, reference_number, created_at")
    .eq("tipe", "in")
    .eq("reference_type", "grn")
    .in("reference_id", Array.from(grnById.keys()))
    .order("created_at", { ascending: false })
    .limit(SCAN_LIMIT);
  if (params.materialId) movementQuery = movementQuery.eq("raw_material_id", params.materialId);

  const { data: movementRows, error: movementError } = await movementQuery;
  if (movementError) throw movementError;
  const movements = ((movementRows ?? []) as MovementRow[]).filter(
    (movement) => Number(movement.unit_cost || 0) > 0
  );

  const materialIds = Array.from(new Set(movements.map((movement) => movement.raw_material_id)));
  const [{ data: materialRows }, { data: supplierRow }] = await Promise.all([
    materialIds.length > 0
      ? db.from("raw_materials").select("id, nama, satuan_besar_id, satuan_kecil_id").in("id", materialIds)
      : Promise.resolve({ data: [] }),
    db.from("suppliers").select("nama_supplier").eq("id", supplierId).maybeSingle(),
  ]);
  const materials = (materialRows ?? []) as MaterialRow[];

  const unitIds = Array.from(
    new Set(
      materials.map((material) => material.satuan_kecil_id || material.satuan_besar_id).filter(Boolean) as string[]
    )
  );
  const { data: unitRows } = unitIds.length > 0
    ? await db.from("units").select("id, nama").in("id", unitIds)
    : { data: [] };

  const history = buildPriceHistory(movements, {
    supplierId,
    supplierName: (supplierRow as { nama_supplier?: string } | null)?.nama_supplier || "",
    grnById,
    materialById: new Map(materials.map((material) => [material.id, material])),
    unitNameById: new Map(
      ((unitRows ?? []) as Array<{ id: string; nama: string | null }>).map((unit) => [unit.id, unit.nama])
    ),
  });

  const from = (params.page - 1) * params.limit;
  return {
    data: history.slice(from, from + params.limit),
    pagination: {
      page: params.page,
      limit: params.limit,
      total: history.length,
      total_pages: Math.ceil(history.length / params.limit),
    },
  };
}

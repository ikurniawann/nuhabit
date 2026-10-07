import type { DbClient } from "@/lib/pg/types";
import { updateRawMaterialLastPurchasePrice } from "@/lib/purchasing/purchase-price";
import { toDateOnly } from "@/lib/inventory/batches";

export interface InventoryLocation {
  branch_id: string | null;
  warehouse_id: string | null;
}

/**
 * Lokasi stok untuk sebuah bahan baku: branch milik bahan baku + warehouse
 * default branch tersebut. Bila bahan baku global (tanpa branch) → null/null
 * (kompatibel dengan stok single-pool lama).
 */
export async function resolveInventoryLocation(
  db: DbClient,
  rawMaterialId: string
): Promise<InventoryLocation> {
  const { data: material } = await db
    .from("raw_materials")
    .select("branch_id")
    .eq("id", rawMaterialId)
    .maybeSingle();

  const branchId = (material as { branch_id: string | null } | null)?.branch_id ?? null;
  if (!branchId) return { branch_id: null, warehouse_id: null };

  const { data: warehouse } = await db
    .from("warehouses", "configuration")
    .select("id")
    .eq("branch_id", branchId)
    .eq("is_active", true)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return {
    branch_id: branchId,
    warehouse_id: (warehouse as { id: string } | null)?.id ?? null,
  };
}

function toQty(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Update qty_on_order saat PO dikirim, dibatalkan, atau barang diterima.
export async function adjustInventoryOnOrder(
  db: DbClient,
  rawMaterialId: string,
  qtyDelta: number,
  userId?: string
): Promise<void> {
  if (qtyDelta === 0) return;

  const { data: existing, error: existingError } = await db
    .from("inventory")
    .select("id, qty_on_order")
    .eq("raw_material_id", rawMaterialId)
    .eq("is_active", true)
    .maybeSingle();

  if (existingError) throw existingError;

  if (existing) {
    const nextQtyOnOrder = Math.max(0, Number(existing.qty_on_order || 0) + qtyDelta);
    const { error } = await db
      .from("inventory")
      .update({
        qty_on_order: nextQtyOnOrder,
        updated_by: userId,
      })
      .eq("id", existing.id);

    if (error) throw error;
    return;
  }

  if (qtyDelta < 0) return;

  const location = await resolveInventoryLocation(db, rawMaterialId);
  const { error } = await db.from("inventory").insert({
    raw_material_id: rawMaterialId,
    qty_available: 0,
    qty_on_order: qtyDelta,
    unit_cost: 0,
    branch_id: location.branch_id,
    warehouse_id: location.warehouse_id,
    created_by: userId,
  });

  if (error) throw error;
}

// Tambah inventory dari GRN
export async function addInventoryFromGrn(
  db: DbClient,
  rawMaterialId: string,
  qtyAdded: number,
  unitCost: number,
  grnId: string,
  grnNumber: string,
  userId: string,
  warehouseId?: string | null,
  batch?: { batchNumber?: string | null; expiryDate?: string | Date | null }
): Promise<void> {
  const qty = toQty(qtyAdded);
  const cost = toQty(unitCost);
  if (qty <= 0) return;

  // Trigger trg_inventory_movement_batches membuat batch dari kolom ini.
  const expiryDate = toDateOnly(batch?.expiryDate);
  const batchColumns = {
    ...(batch?.batchNumber ? { batch_number: batch.batchNumber } : {}),
    ...(expiryDate ? { expiry_date: expiryDate } : {}),
  };

  let location: InventoryLocation;
  if (warehouseId) {
    const { data: warehouse } = await db
      .from("warehouses", "configuration")
      .select("branch_id")
      .eq("id", warehouseId)
      .maybeSingle();
    location = {
      branch_id: (warehouse as { branch_id: string } | null)?.branch_id ?? null,
      warehouse_id: warehouseId,
    };
  } else {
    location = await resolveInventoryLocation(db, rawMaterialId);
  }

  const { data: existing } = await db
    .from("inventory")
    .select("id, qty_available, qty_on_order, unit_cost")
    .eq("raw_material_id", rawMaterialId)
    .eq("warehouse_id", location.warehouse_id)
    .eq("is_active", true)
    .maybeSingle();

  if (existing) {
    const qtyBefore = toQty(existing.qty_available);
    const onOrder = toQty(existing.qty_on_order);
    const prevCost = toQty(existing.unit_cost);
    const totalQty = qtyBefore + qty;
    const newUnitCost =
      totalQty > 0
        ? (qtyBefore * prevCost + qty * cost) / totalQty
        : cost;

    const { error: updateError } = await db.from("inventory").update({
      qty_available: totalQty,
      qty_on_order: Math.max(0, onOrder - qty),
      unit_cost: newUnitCost,
      branch_id: location.branch_id,
      warehouse_id: location.warehouse_id,
      last_movement_at: new Date().toISOString(),
      updated_by: userId,
    }).eq("id", existing.id);

    if (updateError) throw updateError;

    await db.from("inventory_movements").insert({
      inventory_id: existing.id,
      raw_material_id: rawMaterialId,
      tipe: "in",
      jumlah: qty,
      qty_before: qtyBefore,
      qty_after: totalQty,
      // Movement line = transaction cost (PO); inventory.unit_cost stays weighted avg.
      unit_cost: cost,
      total_cost: qty * cost,
      branch_id: location.branch_id,
      warehouse_id: location.warehouse_id,
      reference_type: "grn",
      reference_id: grnId,
      reference_number: grnNumber,
      alasan: `Penerimaan barang dari GRN ${grnNumber}`,
      created_by: userId,
      ...batchColumns,
    });

    await updateRawMaterialLastPurchasePrice(db, {
      rawMaterialId,
      baseUnitCost: cost,
      userId,
    });
    return;
  }

  const { data: newInv, error } = await db.from("inventory").insert({
    raw_material_id: rawMaterialId,
    qty_available: qty,
    unit_cost: cost,
    branch_id: location.branch_id,
    warehouse_id: location.warehouse_id,
    last_movement_at: new Date().toISOString(),
    created_by: userId,
  }).select("id").single();
  if (error) throw error;

  await db.from("inventory_movements").insert({
    inventory_id: newInv.id,
    raw_material_id: rawMaterialId,
    tipe: "in",
    jumlah: qty,
    qty_before: 0,
    qty_after: qty,
    unit_cost: cost,
    total_cost: qty * cost,
    branch_id: location.branch_id,
    warehouse_id: location.warehouse_id,
    reference_type: "grn",
    reference_id: grnId,
    reference_number: grnNumber,
    alasan: `Penerimaan barang dari GRN ${grnNumber}`,
    created_by: userId,
    ...batchColumns,
  });

  await updateRawMaterialLastPurchasePrice(db, {
    rawMaterialId,
    baseUnitCost: cost,
    userId,
  });
}

export async function addInventoryFromProduction(
  db: DbClient,
  rawMaterialId: string,
  qtyAdded: number,
  unitCost: number,
  productionOrderId: string,
  productionNumber: string,
  userId: string,
  referenceType: string = "production_wip"
): Promise<void> {
  if (qtyAdded <= 0) return;

  const { data: existingMovement, error: movementLookupError } = await db
    .from("inventory_movements")
    .select("id")
    .eq("raw_material_id", rawMaterialId)
    .eq("reference_type", referenceType)
    .eq("reference_id", productionOrderId)
    .eq("is_active", true)
    .maybeSingle();

  if (movementLookupError) throw movementLookupError;
  if (existingMovement) return;

  const location = await resolveInventoryLocation(db, rawMaterialId);

  const { data: existing, error: existingError } = await db
    .from("inventory")
    .select("id, qty_available, unit_cost")
    .eq("raw_material_id", rawMaterialId)
    .eq("is_active", true)
    .maybeSingle();

  if (existingError) throw existingError;

  let inventoryId: string;
  let qtyBefore = 0;
  let newUnitCost = unitCost;

  if (existing) {
    qtyBefore = Number(existing.qty_available || 0);
    const totalQty = qtyBefore + qtyAdded;
    newUnitCost = totalQty > 0
      ? ((qtyBefore * Number(existing.unit_cost || 0)) + (qtyAdded * unitCost)) / totalQty
      : unitCost;

    const { error } = await db
      .from("inventory")
      .update({
        qty_available: totalQty,
        unit_cost: newUnitCost,
        branch_id: location.branch_id,
        warehouse_id: location.warehouse_id,
        last_movement_at: new Date().toISOString(),
        updated_by: userId,
      })
      .eq("id", existing.id);

    if (error) throw error;
    inventoryId = existing.id;
  } else {
    const { data: newInventory, error } = await db
      .from("inventory")
      .insert({
        raw_material_id: rawMaterialId,
        qty_available: qtyAdded,
        unit_cost: unitCost,
        branch_id: location.branch_id,
        warehouse_id: location.warehouse_id,
        last_movement_at: new Date().toISOString(),
        created_by: userId,
      })
      .select("id")
      .single();

    if (error) throw error;
    inventoryId = newInventory.id;
  }

  const { error: movementError } = await db.from("inventory_movements").insert({
    inventory_id: inventoryId,
    raw_material_id: rawMaterialId,
    tipe: "in",
    jumlah: qtyAdded,
    qty_before: qtyBefore,
    qty_after: qtyBefore + qtyAdded,
    unit_cost: newUnitCost,
    total_cost: qtyAdded * newUnitCost,
    branch_id: location.branch_id,
    warehouse_id: location.warehouse_id,
    reference_type: "production_wip",
    reference_id: productionOrderId,
    reference_number: productionNumber,
    alasan: `Output WIP dari produksi ${productionNumber}`,
    created_by: userId,
  });

  if (movementError) throw movementError;
}

/** Opening balance when raw materials are bulk-imported. */
export async function addOpeningStockFromImport(
  db: DbClient,
  params: {
    rawMaterialId: string;
    qty: number;
    unitCost: number;
    userId: string;
    warehouseId?: string | null;
    materialKode?: string;
  }
): Promise<void> {
  const qty = toQty(params.qty);
  if (qty <= 0) return;

  let location: InventoryLocation;
  if (params.warehouseId) {
    const { data: warehouse } = await db
      .from("warehouses", "configuration")
      .select("branch_id")
      .eq("id", params.warehouseId)
      .maybeSingle();
    location = {
      branch_id: (warehouse as { branch_id: string | null } | null)?.branch_id ?? null,
      warehouse_id: params.warehouseId,
    };
  } else {
    location = await resolveInventoryLocation(db, params.rawMaterialId);
  }

  const cost = toQty(params.unitCost);
  const referenceNumber = params.materialKode || params.rawMaterialId.slice(0, 8);

  let inventoryQuery = db
    .from("inventory")
    .select("id, qty_available, unit_cost")
    .eq("raw_material_id", params.rawMaterialId)
    .eq("is_active", true);

  if (location.warehouse_id) {
    inventoryQuery = inventoryQuery.eq("warehouse_id", location.warehouse_id);
  } else {
    inventoryQuery = inventoryQuery.is("warehouse_id", null);
  }

  const { data: existing, error: existingError } = await inventoryQuery.maybeSingle();
  if (existingError) throw existingError;

  if (existing) {
    const qtyBefore = toQty(existing.qty_available);
    const totalQty = qtyBefore + qty;
    const prevCost = toQty(existing.unit_cost);
    const newUnitCost =
      totalQty > 0 ? (qtyBefore * prevCost + qty * cost) / totalQty : cost;

    const { error: updateError } = await db
      .from("inventory")
      .update({
        qty_available: totalQty,
        unit_cost: newUnitCost,
        branch_id: location.branch_id,
        warehouse_id: location.warehouse_id,
        last_movement_at: new Date().toISOString(),
        updated_by: params.userId,
      })
      .eq("id", existing.id);

    if (updateError) throw updateError;

    const { error: movementError } = await db.from("inventory_movements").insert({
      inventory_id: existing.id,
      raw_material_id: params.rawMaterialId,
      tipe: "in",
      jumlah: qty,
      qty_before: qtyBefore,
      qty_after: totalQty,
      unit_cost: newUnitCost,
      total_cost: qty * newUnitCost,
      branch_id: location.branch_id,
      warehouse_id: location.warehouse_id,
      reference_type: "import",
      reference_number: referenceNumber,
      alasan: `Opening stock from raw material import (${referenceNumber})`,
      created_by: params.userId,
    });

    if (movementError) throw movementError;
    return;
  }

  const { data: newInv, error: insertError } = await db
    .from("inventory")
    .insert({
      raw_material_id: params.rawMaterialId,
      qty_available: qty,
      unit_cost: cost,
      branch_id: location.branch_id,
      warehouse_id: location.warehouse_id,
      last_movement_at: new Date().toISOString(),
      created_by: params.userId,
    })
    .select("id")
    .single();

  if (insertError) throw insertError;

  const { error: movementError } = await db.from("inventory_movements").insert({
    inventory_id: newInv.id,
    raw_material_id: params.rawMaterialId,
    tipe: "in",
    jumlah: qty,
    qty_before: 0,
    qty_after: qty,
    unit_cost: cost,
    total_cost: qty * cost,
    branch_id: location.branch_id,
    warehouse_id: location.warehouse_id,
    reference_type: "import",
    reference_number: referenceNumber,
    alasan: `Opening stock from raw material import (${referenceNumber})`,
    created_by: params.userId,
  });

  if (movementError) throw movementError;
}

/** Set absolute stock qty at a stall (used when re-importing exported spreadsheets). */
export async function setStockFromImport(
  db: DbClient,
  params: {
    rawMaterialId: string;
    qtyActual: number;
    unitCost: number;
    userId: string;
    warehouseId?: string | null;
    materialKode?: string;
  }
): Promise<void> {
  const qtyActual = toQty(params.qtyActual);
  if (qtyActual < 0) {
    throw new Error("Stock quantity cannot be negative");
  }

  let location: InventoryLocation;
  if (params.warehouseId) {
    const { data: warehouse } = await db
      .from("warehouses", "configuration")
      .select("branch_id")
      .eq("id", params.warehouseId)
      .maybeSingle();
    location = {
      branch_id: (warehouse as { branch_id: string | null } | null)?.branch_id ?? null,
      warehouse_id: params.warehouseId,
    };
  } else {
    location = await resolveInventoryLocation(db, params.rawMaterialId);
  }

  const cost = toQty(params.unitCost);
  const referenceNumber = params.materialKode || params.rawMaterialId.slice(0, 8);

  let inventoryQuery = db
    .from("inventory")
    .select("id, qty_available, unit_cost")
    .eq("raw_material_id", params.rawMaterialId)
    .eq("is_active", true);

  if (location.warehouse_id) {
    inventoryQuery = inventoryQuery.eq("warehouse_id", location.warehouse_id);
  } else {
    inventoryQuery = inventoryQuery.is("warehouse_id", null);
  }

  const { data: existing, error: existingError } = await inventoryQuery.maybeSingle();
  if (existingError) throw existingError;

  if (existing) {
    const qtyBefore = toQty(existing.qty_available);
    const qtyDiff = qtyActual - qtyBefore;
    const unitCost = qtyActual > 0 ? cost || toQty(existing.unit_cost) : toQty(existing.unit_cost);

    const { error: updateError } = await db
      .from("inventory")
      .update({
        qty_available: qtyActual,
        unit_cost: unitCost,
        branch_id: location.branch_id,
        warehouse_id: location.warehouse_id,
        last_movement_at: new Date().toISOString(),
        updated_by: params.userId,
      })
      .eq("id", existing.id);

    if (updateError) throw updateError;

    if (qtyDiff !== 0) {
      const { error: movementError } = await db.from("inventory_movements").insert({
        inventory_id: existing.id,
        raw_material_id: params.rawMaterialId,
        tipe: "adjustment",
        jumlah: Math.abs(qtyDiff),
        qty_before: qtyBefore,
        qty_after: qtyActual,
        unit_cost: unitCost,
        total_cost: Math.abs(qtyDiff) * unitCost,
        branch_id: location.branch_id,
        warehouse_id: location.warehouse_id,
        reference_type: "import",
        reference_number: referenceNumber,
        alasan: `Stock updated from import (${referenceNumber})`,
        created_by: params.userId,
      });

      if (movementError) throw movementError;
    }

    return;
  }

  if (qtyActual === 0) return;

  const { data: newInv, error: insertError } = await db
    .from("inventory")
    .insert({
      raw_material_id: params.rawMaterialId,
      qty_available: qtyActual,
      unit_cost: cost,
      branch_id: location.branch_id,
      warehouse_id: location.warehouse_id,
      last_movement_at: new Date().toISOString(),
      created_by: params.userId,
    })
    .select("id")
    .single();

  if (insertError) throw insertError;

  const { error: movementError } = await db.from("inventory_movements").insert({
    inventory_id: newInv.id,
    raw_material_id: params.rawMaterialId,
    tipe: "in",
    jumlah: qtyActual,
    qty_before: 0,
    qty_after: qtyActual,
    unit_cost: cost,
    total_cost: qtyActual * cost,
    branch_id: location.branch_id,
    warehouse_id: location.warehouse_id,
    reference_type: "import",
    reference_number: referenceNumber,
    alasan: `Opening stock from import (${referenceNumber})`,
    created_by: params.userId,
  });

  if (movementError) throw movementError;
}

// Kurangi inventory saat GRN dihapus
export async function removeInventoryFromGrn(
  db: DbClient,
  rawMaterialId: string,
  qtyRemoved: number,
  grnId: string,
  grnNumber: string,
  userId: string
): Promise<void> {
  if (qtyRemoved <= 0) return;

  const qty = toQty(qtyRemoved);
  if (qty <= 0) return;

  const location = await resolveInventoryLocation(db, rawMaterialId);

  const { data: existing } = await db
    .from("inventory")
    .select("id, qty_available, qty_on_order")
    .eq("raw_material_id", rawMaterialId)
    .eq("is_active", true)
    .maybeSingle();

  if (!existing) return;

  const qtyBefore = toQty(existing.qty_available);
  const qtyAfter = Math.max(0, qtyBefore - qty);

  await db.from("inventory").update({
    qty_available: qtyAfter,
    qty_on_order: toQty(existing.qty_on_order) + qty,
    branch_id: location.branch_id,
    warehouse_id: location.warehouse_id,
    last_movement_at: new Date().toISOString(),
    updated_by: userId,
  }).eq("id", existing.id);

  await db.from("inventory_movements").insert({
    inventory_id: existing.id,
    raw_material_id: rawMaterialId,
    tipe: "out",
    jumlah: qty,
    qty_before: qtyBefore,
    qty_after: qtyAfter,
    branch_id: location.branch_id,
    warehouse_id: location.warehouse_id,
    reference_type: "grn_delete",
    reference_id: grnId,
    reference_number: grnNumber,
    alasan: `Pembatalan GRN ${grnNumber}`,
    created_by: userId,
  });
}

const QTY_EPSILON = 0.000001;

/** Reduce warehouse stock when a purchase return is approved (same warehouse as GRN receipt). */
export async function reduceInventoryFromPurchaseReturn(
  db: DbClient,
  params: {
    rawMaterialId: string;
    qtyReturned: number;
    unitCost: number;
    returnId: string;
    returnNumber: string;
    warehouseId?: string | null;
    userId: string;
    conditionNotes?: string | null;
  }
): Promise<void> {
  const qty = toQty(params.qtyReturned);
  if (qty <= 0) return;

  let location: InventoryLocation;
  if (params.warehouseId) {
    const { data: warehouse } = await db
      .from("warehouses", "configuration")
      .select("branch_id")
      .eq("id", params.warehouseId)
      .maybeSingle();
    location = {
      branch_id: (warehouse as { branch_id: string | null } | null)?.branch_id ?? null,
      warehouse_id: params.warehouseId,
    };
  } else {
    location = await resolveInventoryLocation(db, params.rawMaterialId);
  }

  let inventoryQuery = db
    .from("inventory")
    .select("id, qty_available, unit_cost")
    .eq("raw_material_id", params.rawMaterialId)
    .eq("is_active", true);

  if (location.warehouse_id) {
    inventoryQuery = inventoryQuery.eq("warehouse_id", location.warehouse_id);
  } else {
    inventoryQuery = inventoryQuery.is("warehouse_id", null);
  }

  const { data: existing, error: existingError } = await inventoryQuery.maybeSingle();
  if (existingError) throw existingError;

  if (!existing) {
    throw new Error("Insufficient stock in the receipt warehouse for this return");
  }

  const qtyBefore = toQty(existing.qty_available);
  if (qtyBefore + QTY_EPSILON < qty) {
    throw new Error("Insufficient stock in the receipt warehouse for this return");
  }

  const qtyAfter = Math.max(0, qtyBefore - qty);
  const unitCost = toQty(params.unitCost) || toQty(existing.unit_cost);

  const { error: updateError } = await db
    .from("inventory")
    .update({
      qty_available: qtyAfter,
      branch_id: location.branch_id,
      warehouse_id: location.warehouse_id,
      last_movement_at: new Date().toISOString(),
      updated_by: params.userId,
    })
    .eq("id", existing.id);

  if (updateError) throw updateError;

  const { error: movementError } = await db.from("inventory_movements").insert({
    inventory_id: existing.id,
    raw_material_id: params.rawMaterialId,
    tipe: "return",
    jumlah: qty,
    qty_before: qtyBefore,
    qty_after: qtyAfter,
    unit_cost: unitCost,
    total_cost: qty * unitCost,
    branch_id: location.branch_id,
    warehouse_id: location.warehouse_id,
    reference_type: "purchase_return",
    reference_id: params.returnId,
    reference_number: params.returnNumber,
    return_id: params.returnId,
    alasan: params.conditionNotes
      ? `Purchase return ${params.returnNumber}: ${params.conditionNotes}`
      : `Purchase return ${params.returnNumber}`,
    created_by: params.userId,
  });

  if (movementError) throw movementError;
}

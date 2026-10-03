import type { DbClient } from "@/lib/pg/types";

const QTY_EPSILON = 0.0001;
const EDITABLE_STATUSES = ["draft", "pending_approval"] as const;

export type VendorCreditSourceType = "receive_reject" | "qc_reject";

export type VendorCreditStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "cancelled";

function toQty(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toAmount(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundAmount(value: number) {
  return Math.round(value * 100) / 100;
}

/** Migration not applied yet — avoid breaking PO/invoice reads. */
function isVendorCreditsUnavailable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string };
  const msg = String(e.message || "").toLowerCase();
  return (
    e.code === "42P01" ||
    e.code === "PGRST205" ||
    e.code === "PGRST204" ||
    (msg.includes("vendor_credit") &&
      (msg.includes("does not exist") ||
        msg.includes("could not find") ||
        msg.includes("schema cache")))
  );
}

type GrnContext = {
  id: string;
  supplier_id: string | null;
  purchase_order_id: string | null;
};

async function loadGrnContext(db: DbClient, grnId: string): Promise<GrnContext | null> {
  const { data, error } = await db
    .from("grn")
    .select("id, supplier_id, purchase_order_id")
    .eq("id", grnId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw error;
  return data as GrnContext | null;
}

type CreditLineInput = {
  grn_item_id: string;
  raw_material_id: string;
  qty: number;
  unit_price: number;
  notes?: string | null;
};

async function findEditableCredit(
  db: DbClient,
  grnId: string,
  sourceType: VendorCreditSourceType
) {
  const { data, error } = await db
    .from("vendor_credits")
    .select("id, status, total_amount, credit_number, source_type")
    .eq("grn_id", grnId)
    .eq("source_type", sourceType)
    .in("status", [...EDITABLE_STATUSES])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function cancelEditableCredits(
  db: DbClient,
  grnId: string,
  sourceType: VendorCreditSourceType
) {
  const credit = await findEditableCredit(db, grnId, sourceType);
  if (!credit?.id) return null;

  await db.from("vendor_credit_items").delete().eq("vendor_credit_id", credit.id);
  const { data, error } = await db
    .from("vendor_credits")
    .update({
      status: "cancelled",
      total_amount: 0,
      updated_at: new Date().toISOString(),
    })
    .eq("id", credit.id)
    .select("id")
    .single();

  if (error) throw error;
  return data;
}

async function upsertVendorCredit(
  db: DbClient,
  params: {
    grn: GrnContext;
    sourceType: VendorCreditSourceType;
    lines: CreditLineInput[];
    reasonNotes: string;
    userId?: string | null;
  }
) {
  const { grn, sourceType, lines, reasonNotes, userId } = params;
  const activeLines = lines.filter((line) => line.qty > QTY_EPSILON);

  if (!activeLines.length) {
    await cancelEditableCredits(db, grn.id, sourceType);
    return null;
  }

  const totalAmount = roundAmount(
    activeLines.reduce((sum, line) => sum + roundAmount(line.qty * line.unit_price), 0)
  );

  let credit = await findEditableCredit(db, grn.id, sourceType);

  if (!credit?.id) {
    const { data: created, error: createError } = await db
      .from("vendor_credits")
      .insert({
        grn_id: grn.id,
        purchase_order_id: grn.purchase_order_id,
        supplier_id: grn.supplier_id,
        source_type: sourceType,
        status: "draft",
        total_amount: totalAmount,
        reason_notes: reasonNotes,
        notes: null,
        created_by: userId ?? null,
        updated_at: new Date().toISOString(),
      })
      .select("id, credit_number, status, total_amount, source_type")
      .single();

    if (createError) throw createError;
    credit = created;
  } else {
    const { error: updateError } = await db
      .from("vendor_credits")
      .update({
        total_amount: totalAmount,
        reason_notes: reasonNotes,
        updated_at: new Date().toISOString(),
      })
      .eq("id", credit.id);

    if (updateError) throw updateError;

    await db.from("vendor_credit_items").delete().eq("vendor_credit_id", credit.id);
  }

  const payload = activeLines.map((line) => ({
    vendor_credit_id: credit!.id,
    grn_item_id: line.grn_item_id,
    raw_material_id: line.raw_material_id,
    qty: line.qty,
    unit_price: line.unit_price,
    line_amount: roundAmount(line.qty * line.unit_price),
    notes: line.notes ?? null,
  }));

  const { error: itemsError } = await db.from("vendor_credit_items").insert(payload);
  if (itemsError) throw itemsError;

  return credit;
}

export async function syncReceiveRejectCredits(
  db: DbClient,
  grnId: string,
  userId?: string | null
) {
  const grn = await loadGrnContext(db, grnId);
  if (!grn) return null;

  const { data: items, error } = await db
    .from("grn_items")
    .select(
      `
      id,
      raw_material_id,
      qty_ditolak,
      catatan,
      purchase_order_item:purchase_order_items!purchase_order_item_id (
        harga_satuan
      )
    `
    )
    .eq("grn_id", grnId)
    .eq("is_active", true);

  if (error) throw error;

  const lines: CreditLineInput[] = (items || [])
    .filter((item) => Boolean(item.raw_material_id))
    .map((item) => ({
      grn_item_id: item.id as string,
      raw_material_id: item.raw_material_id as string,
      qty: toQty(item.qty_ditolak),
      unit_price: toAmount(
        (item.purchase_order_item as { harga_satuan?: number | null } | null)?.harga_satuan
      ),
      notes: (item.catatan as string | null) ?? null,
    }));

  return upsertVendorCredit(db, {
    grn,
    sourceType: "receive_reject",
    lines,
    reasonNotes: "Auto-generated from goods receipt reject quantities",
    userId,
  });
}

export async function syncQcRejectCredits(
  db: DbClient,
  grnId: string,
  userId?: string | null
) {
  const grn = await loadGrnContext(db, grnId);
  if (!grn) return null;

  const { data: qc, error: qcError } = await db
    .from("grn_qc_inspections")
    .select("id, inventory_posted")
    .eq("grn_id", grnId)
    .maybeSingle();

  if (qcError) throw qcError;
  if (!qc?.inventory_posted) {
    await cancelEditableCredits(db, grnId, "qc_reject");
    return null;
  }

  const { data: qcItems, error } = await db
    .from("grn_qc_inspection_items")
    .select(
      `
      grn_item_id,
      raw_material_id,
      qty_rejected,
      catatan,
      grn_item:grn_items!grn_item_id (
        purchase_order_item:purchase_order_items!purchase_order_item_id (
          harga_satuan
        )
      )
    `
    )
    .eq("qc_inspection_id", qc.id);

  if (error) throw error;

  const lines: CreditLineInput[] = (qcItems || [])
    .filter((item) => Boolean(item.raw_material_id))
    .map((item) => {
      const grnItem = item.grn_item as {
        purchase_order_item?: { harga_satuan?: number | null } | null;
      } | null;

      return {
        grn_item_id: item.grn_item_id as string,
        raw_material_id: item.raw_material_id as string,
        qty: toQty(item.qty_rejected),
        unit_price: toAmount(grnItem?.purchase_order_item?.harga_satuan),
        notes: (item.catatan as string | null) ?? null,
      };
    });

  return upsertVendorCredit(db, {
    grn,
    sourceType: "qc_reject",
    lines,
    reasonNotes: "Auto-generated from QC reject quantities",
    userId,
  });
}

/** Cancel draft/pending reject credits for all GRNs on a PO (superseded by qty shortage). */
export async function cancelDraftRejectCreditsForPo(db: DbClient, poId: string) {
  try {
    const { data: grns, error: grnError } = await db
      .from("grn")
      .select("id")
      .eq("purchase_order_id", poId)
      .eq("is_active", true);

    if (grnError) throw grnError;
    const grnIds = (grns || []).map((g) => g.id).filter(Boolean) as string[];
    if (!grnIds.length) return;

    const { data: credits, error } = await db
      .from("vendor_credits")
      .select("id")
      .in("grn_id", grnIds)
      .in("source_type", ["receive_reject", "qc_reject"])
      .in("status", [...EDITABLE_STATUSES]);

    if (error) throw error;

    for (const credit of credits || []) {
      if (!credit.id) continue;
      await db.from("vendor_credit_items").delete().eq("vendor_credit_id", credit.id);
      await db
        .from("vendor_credits")
        .update({
          status: "cancelled",
          total_amount: 0,
          reason_notes: "Dibatalkan saat PO ditutup — kekurangan dihitung dari sisa qty",
          updated_at: new Date().toISOString(),
        })
        .eq("id", credit.id);
    }
  } catch (error) {
    if (isVendorCreditsUnavailable(error)) return;
    throw error;
  }
}

export async function getVendorCreditsByGrnId(db: DbClient, grnId: string) {
  const { data, error } = await db
    .from("vendor_credits")
    .select(
      `
      id,
      credit_number,
      grn_id,
      purchase_order_id,
      supplier_id,
      source_type,
      credit_date,
      status,
      total_amount,
      reason_notes,
      notes,
      approved_at,
      created_at,
      items:vendor_credit_items (
        id,
        grn_item_id,
        raw_material_id,
        qty,
        unit_price,
        line_amount,
        notes,
        raw_material:raw_materials!raw_material_id (
          kode,
          nama
        )
      )
    `
    )
    .eq("grn_id", grnId)
    .neq("status", "cancelled")
    .order("created_at", { ascending: true });

  if (error) {
    if (isVendorCreditsUnavailable(error)) return [];
    throw error;
  }
  return data || [];
}

export async function approveVendorCredit(
  db: DbClient,
  creditId: string,
  approverId: string,
  options: { expiryDate?: string | null } = {}
) {
  const { data: credit, error } = await db
    .from("vendor_credits")
    .select("id, status, total_amount, credit_number, source_type")
    .eq("id", creditId)
    .maybeSingle();

  if (error) throw error;
  if (!credit) throw new Error("Vendor credit not found");

  if (
    credit.source_type === "receive_reject" ||
    credit.source_type === "qc_reject"
  ) {
    throw new Error(
      "Kredit tolak penerimaan/QC tidak disetujui dari GRN. Kekurangan ditagihkan lewat sisa qty PO; tutup PO bila supplier tidak mengganti."
    );
  }

  if (!EDITABLE_STATUSES.includes(credit.status as (typeof EDITABLE_STATUSES)[number])) {
    throw new Error("Vendor credit can only be approved from draft or pending approval");
  }

  if (toAmount(credit.total_amount) <= QTY_EPSILON) {
    throw new Error("Vendor credit has no amount to approve");
  }

  const { data: updated, error: updateError } = await db
    .from("vendor_credits")
    .update({
      status: "approved",
      approved_by: approverId,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...(options.expiryDate ? { expiry_date: options.expiryDate } : {}),
    })
    .eq("id", creditId)
    .select(
      `
      *,
      items:vendor_credit_items (
        id,
        grn_item_id,
        raw_material_id,
        qty,
        unit_price,
        line_amount
      )
    `
    )
    .single();

  if (updateError) throw updateError;
  return updated;
}

export async function getVendorCreditsByPoIds(
  db: DbClient,
  poIds: string[]
): Promise<Map<string, number>> {
  const credits = new Map<string, number>();
  if (!poIds.length) return credits;

  try {
    const { data: grns, error: grnError } = await db
      .from("grn")
      .select("id, purchase_order_id")
      .in("purchase_order_id", poIds)
      .eq("is_active", true);

    if (grnError) throw grnError;

    const grnToPo = new Map<string, string>();
    const grnIds: string[] = [];
    for (const grn of grns || []) {
      if (!grn.id || !grn.purchase_order_id) continue;
      grnToPo.set(grn.id, grn.purchase_order_id);
      grnIds.push(grn.id);
    }

    // Kredit mengurangi PO asalnya, kecuali bagian yang sudah dipakai ke PO
    // lain (vendor_credit_applications); bagian itu mengurangi PO tujuan.
    const add = (poId: string, amount: number) =>
      credits.set(poId, roundAmount((credits.get(poId) || 0) + amount));

    const { data: rows, error } = grnIds.length
      ? await db
          .from("vendor_credits")
          .select("grn_id, total_amount, applied_amount")
          .in("grn_id", grnIds)
          .eq("status", "approved")
      : { data: [], error: null };

    if (error) throw error;

    for (const row of rows || []) {
      if (!row.grn_id) continue;
      const poId = grnToPo.get(row.grn_id);
      if (!poId) continue;
      add(poId, toAmount(row.total_amount) - toAmount(row.applied_amount));
    }

    const { data: applications, error: applicationsError } = await db
      .from("vendor_credit_applications")
      .select("purchase_order_id, amount")
      .in("purchase_order_id", poIds)
      .is("voided_at", null);

    if (applicationsError) throw applicationsError;

    for (const row of applications || []) {
      add(row.purchase_order_id, toAmount(row.amount));
    }

    return credits;
  } catch (error) {
    if (isVendorCreditsUnavailable(error)) return credits;
    throw error;
  }
}

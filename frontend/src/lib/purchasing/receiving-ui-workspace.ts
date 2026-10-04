/**
 * Baris workspace penerimaan (halaman GRN): gabungkan PO, pengiriman dan GRN
 * menjadi satu baris per PO, lalu tentukan status dan aksi yang tersedia.
 */

export type ReceivingStatus =
  | "waiting_delivery"
  | "in_delivery"
  | "partially_received"
  | "received"
  | "rejected"
  | "cancelled";

export type WorkspacePurchaseOrder = {
  id: string;
  nomor_po: string;
  nama_supplier?: string | null;
  status: string;
  tanggal_po?: string | null;
  total_qty_ordered?: number | null;
  total_qty_received?: number | null;
};

export type WorkspaceDelivery = {
  id: string;
  po_id?: string | null;
  po_number?: string | null;
  delivery_number?: string | null;
  no_surat_jalan?: string | null;
  no_resi?: string | null;
  tanggal_kirim?: string | null;
  status: string;
};

export type WorkspaceGrn = {
  id: string;
  nomor_grn: string;
  delivery_id?: string | null;
  po_id?: string | null;
  no_surat_jalan?: string | null;
  tanggal_penerimaan?: string | null;
  status: string;
  total_item_diterima?: number | null;
  total_item_ditolak?: number | null;
};

export type ReceivingWorkspaceData = {
  purchase_orders: WorkspacePurchaseOrder[];
  deliveries: WorkspaceDelivery[];
  grns: WorkspaceGrn[];
};

export type ReceivingRow = {
  key: string;
  status: ReceivingStatus;
  poId: string | null;
  poNumber: string;
  poStatus: string | null;
  supplierName: string;
  deliveryId: string | null;
  deliveryNumber: string | null;
  suratJalan: string | null;
  grnId: string | null;
  grnNumber: string | null;
  date: string | null;
  orderedQty: number;
  receivedQty: number;
  remainingQty: number;
  deliveries: WorkspaceDelivery[];
  grns: WorkspaceGrn[];
  pendingDelivery: WorkspaceDelivery | null;
  latestGrn: WorkspaceGrn | null;
};

export const RECEIVING_STATUS_LABELS: Record<ReceivingStatus, string> = {
  waiting_delivery: "Menunggu Pengiriman",
  in_delivery: "Dalam Pengiriman",
  partially_received: "Diterima Sebagian",
  received: "Diterima Penuh",
  rejected: "Ditolak",
  cancelled: "Dibatalkan",
};

export const RECEIVING_STATUS_STYLES: Record<ReceivingStatus, string> = {
  waiting_delivery: "bg-slate-100 text-slate-700 border-slate-200",
  in_delivery: "bg-pink-50 text-pink-700 border-pink-200",
  partially_received: "bg-amber-50 text-amber-700 border-amber-200",
  received: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
  cancelled: "bg-gray-100 text-gray-600 border-gray-200",
};

const STATUS_PRIORITY: Record<ReceivingStatus, number> = {
  in_delivery: 1,
  partially_received: 2,
  waiting_delivery: 3,
  rejected: 4,
  received: 5,
  cancelled: 6,
};

const TRACKED_PO_STATUSES = ["approved", "sent", "partially_received", "received", "cancelled", "closed"];

export function normalizeStatus(value?: string | null): string {
  return (value || "").toLowerCase();
}

export function deliveryLabel(delivery: WorkspaceDelivery): string {
  return delivery.no_resi || delivery.delivery_number || delivery.no_surat_jalan || "Pengiriman";
}

function groupBy<T>(items: T[], keyOf: (item: T) => string | null | undefined) {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    if (!key) continue;
    map.set(key, [...(map.get(key) ?? []), item]);
  }
  return map;
}

const byDesc = <T>(field: (item: T) => string | null | undefined) => (a: T, b: T) =>
  String(field(b) || "").localeCompare(String(field(a) || ""));

function poRowStatus(
  poStatus: string,
  remainingQty: number,
  hasPendingDelivery: boolean,
  hasActiveDelivery: boolean,
  grnCount: number
): ReceivingStatus {
  if (poStatus === "cancelled") return "cancelled";
  if (poStatus === "closed") return remainingQty > 0 ? "partially_received" : "received";
  if (poStatus === "received" || remainingQty <= 0) return "received";
  if (hasPendingDelivery || (hasActiveDelivery && grnCount === 0)) return "in_delivery";
  if (poStatus === "partially_received" || grnCount > 0) return "partially_received";
  return "waiting_delivery";
}

/** Satu baris per PO yang sudah punya pengiriman, plus pengiriman yatim tanpa PO dikenal. */
export function buildReceivingRows(data: ReceivingWorkspaceData): ReceivingRow[] {
  const deliveriesByPo = groupBy(data.deliveries, (d) => d.po_id);
  const grnsByPo = groupBy(data.grns, (g) => g.po_id);
  const grnsByDelivery = groupBy(data.grns, (g) => g.delivery_id);
  const handledPoIds = new Set<string>();
  const rows: ReceivingRow[] = [];

  for (const po of data.purchase_orders) {
    const poStatus = normalizeStatus(po.status);
    if (!TRACKED_PO_STATUSES.includes(poStatus)) continue;

    const poDeliveries = [...(deliveriesByPo.get(po.id) ?? [])].sort(byDesc((d) => d.tanggal_kirim));
    if (poDeliveries.length === 0) continue;

    const poGrns = [...(grnsByPo.get(po.id) ?? [])].sort(byDesc((g) => g.tanggal_penerimaan));
    const pendingDelivery =
      poDeliveries.find((d) => d.status !== "cancelled" && !grnsByDelivery.get(d.id)?.length) ?? null;
    const latestDelivery = poDeliveries.find((d) => d.status !== "cancelled") ?? null;
    const latestGrn = poGrns[0] ?? null;
    handledPoIds.add(po.id);

    const orderedQty = Number(po.total_qty_ordered || 0);
    const receivedQty = Number(po.total_qty_received || 0);
    const remainingQty = Math.max(0, orderedQty - receivedQty);

    rows.push({
      key: `po-${po.id}`,
      status: poRowStatus(poStatus, remainingQty, Boolean(pendingDelivery), Boolean(latestDelivery), poGrns.length),
      poId: po.id,
      poNumber: po.nomor_po,
      poStatus,
      supplierName: po.nama_supplier || "-",
      deliveryId: pendingDelivery?.id || latestDelivery?.id || null,
      deliveryNumber: latestDelivery ? deliveryLabel(latestDelivery) : null,
      suratJalan: latestDelivery?.no_surat_jalan || latestGrn?.no_surat_jalan || null,
      grnId: latestGrn?.id || null,
      grnNumber: latestGrn?.nomor_grn || null,
      date: latestGrn?.tanggal_penerimaan || latestDelivery?.tanggal_kirim || po.tanggal_po || null,
      orderedQty,
      receivedQty,
      remainingQty,
      deliveries: poDeliveries,
      grns: poGrns,
      pendingDelivery,
      latestGrn,
    });
  }

  for (const delivery of data.deliveries) {
    if (delivery.po_id && handledPoIds.has(delivery.po_id)) continue;
    const grn = grnsByDelivery.get(delivery.id)?.[0] ?? null;
    let status: ReceivingStatus = delivery.status === "cancelled" ? "cancelled" : "in_delivery";
    if (grn?.status === "received" || grn?.status === "partially_received" || grn?.status === "rejected") {
      status = grn.status;
    }

    rows.push({
      key: `delivery-${delivery.id}`,
      status,
      poId: delivery.po_id || null,
      poNumber: delivery.po_number || "-",
      poStatus: null,
      supplierName: "-",
      deliveryId: delivery.id,
      deliveryNumber: delivery.no_resi || delivery.po_number || null,
      suratJalan: delivery.no_surat_jalan || null,
      grnId: grn?.id || null,
      grnNumber: grn?.nomor_grn || null,
      date: grn?.tanggal_penerimaan || delivery.tanggal_kirim || null,
      orderedQty: 0,
      receivedQty: Number(grn?.total_item_diterima || 0),
      remainingQty: 0,
      deliveries: [delivery],
      grns: grn ? [grn] : [],
      pendingDelivery: grn ? null : delivery,
      latestGrn: grn,
    });
  }

  return rows.sort((a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status]);
}

export function filterReceivingRows(
  rows: ReceivingRow[],
  status: ReceivingStatus | "all",
  search: string
): ReceivingRow[] {
  const needle = search.toLowerCase();
  return rows.filter((row) => {
    if (status !== "all" && row.status !== status) return false;
    const haystack = [
      row.poNumber,
      row.supplierName,
      row.deliveryNumber,
      row.suratJalan,
      row.grnNumber,
      ...row.grns.map((grn) => grn.nomor_grn),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

export function countReceivingRows(rows: ReceivingRow[]): Partial<Record<ReceivingStatus, number>> {
  const counts: Partial<Record<ReceivingStatus, number>> = {};
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
  return counts;
}

export function isFullyReceived(row: ReceivingRow): boolean {
  return row.status === "received" || row.remainingQty <= 0;
}

/** Sisa PO tanpa pengiriman terbuka: perlu Kirim Ulang, bukan melanjutkan GRN lama. */
export function canReshipForRemaining(row: ReceivingRow): boolean {
  return (
    !isFullyReceived(row) &&
    !row.pendingDelivery &&
    Boolean(row.poId) &&
    (row.status === "partially_received" || row.latestGrn?.status === "partially_received")
  );
}

export function canRunQualityControl(row: ReceivingRow): boolean {
  return Boolean(row.grnId) && row.latestGrn?.status === "pending";
}

import { describe, expect, it } from "vitest";
import {
  buildReceivingRows,
  canReshipForRemaining,
  canRunQualityControl,
  countReceivingRows,
  filterReceivingRows,
  type ReceivingWorkspaceData,
  type WorkspaceDelivery,
  type WorkspaceGrn,
  type WorkspacePurchaseOrder,
} from "./receiving-ui-workspace";

const po = (over: Partial<WorkspacePurchaseOrder> = {}): WorkspacePurchaseOrder => ({
  id: "po-1",
  nomor_po: "PO-1",
  nama_supplier: "Sumber Rejeki",
  status: "sent",
  total_qty_ordered: 10,
  total_qty_received: 0,
  ...over,
});
const delivery = (over: Partial<WorkspaceDelivery> = {}): WorkspaceDelivery => ({
  id: "d-1",
  po_id: "po-1",
  no_resi: "RESI-1",
  no_surat_jalan: "SJ-1",
  tanggal_kirim: "2026-10-01",
  status: "pending",
  ...over,
});
const grn = (over: Partial<WorkspaceGrn> = {}): WorkspaceGrn => ({
  id: "g-1",
  nomor_grn: "GRN-1",
  delivery_id: "d-1",
  po_id: "po-1",
  tanggal_penerimaan: "2026-10-02",
  status: "partially_received",
  ...over,
});
const data = (over: Partial<ReceivingWorkspaceData>): ReceivingWorkspaceData => ({
  purchase_orders: [],
  deliveries: [],
  grns: [],
  ...over,
});

describe("buildReceivingRows", () => {
  it("skips POs without deliveries; a draft PO's delivery shows as its own row", () => {
    expect(buildReceivingRows(data({ purchase_orders: [po()] }))).toEqual([]);
    const rows = buildReceivingRows(data({ purchase_orders: [po({ status: "draft" })], deliveries: [delivery()] }));
    expect(rows.map((r) => r.key)).toEqual(["delivery-d-1"]);
  });

  it("marks a PO with an un-received delivery as in delivery", () => {
    const [row] = buildReceivingRows(data({ purchase_orders: [po()], deliveries: [delivery()] }));
    expect(row).toMatchObject({ status: "in_delivery", deliveryId: "d-1", pendingDelivery: { id: "d-1" }, remainingQty: 10, suratJalan: "SJ-1" });
  });

  it("marks partial receipts and offers a reship when no delivery is open", () => {
    const [row] = buildReceivingRows(
      data({ purchase_orders: [po({ total_qty_received: 6 })], deliveries: [delivery()], grns: [grn()] })
    );
    expect(row).toMatchObject({ status: "partially_received", remainingQty: 4, grnNumber: "GRN-1", pendingDelivery: null });
    expect(canReshipForRemaining(row)).toBe(true);
    expect(canRunQualityControl(row)).toBe(false);
  });

  it("treats a closed PO with a shortfall as partially received and full as received", () => {
    const closed = buildReceivingRows(data({ purchase_orders: [po({ status: "closed", total_qty_received: 6 })], deliveries: [delivery()] }));
    expect(closed[0].status).toBe("partially_received");
    const full = buildReceivingRows(data({ purchase_orders: [po({ total_qty_received: 10 })], deliveries: [delivery()] }));
    expect(full[0].status).toBe("received");
  });

  it("adds orphan deliveries using their GRN status and sorts by priority", () => {
    const rows = buildReceivingRows(
      data({
        purchase_orders: [po({ total_qty_received: 10 })],
        deliveries: [delivery(), delivery({ id: "d-2", po_id: "po-x", po_number: "PO-X" })],
        grns: [grn({ id: "g-2", delivery_id: "d-2", po_id: "po-x", status: "pending" })],
      })
    );
    expect(rows.map((r) => r.key)).toEqual(["delivery-d-2", "po-po-1"]);
    expect(rows[0]).toMatchObject({ status: "in_delivery", grnId: "g-2", pendingDelivery: null });
    expect(canRunQualityControl(rows[0])).toBe(true);
  });
});

describe("filterReceivingRows / countReceivingRows", () => {
  const rows = buildReceivingRows(
    data({
      purchase_orders: [po(), po({ id: "po-2", nomor_po: "PO-2", total_qty_received: 10 })],
      deliveries: [delivery(), delivery({ id: "d-2", po_id: "po-2", no_surat_jalan: "SJ-ZZ" })],
    })
  );

  it("filters by status and a case-insensitive search", () => {
    expect(filterReceivingRows(rows, "received", "").map((r) => r.poId)).toEqual(["po-2"]);
    expect(filterReceivingRows(rows, "all", "sj-zz").map((r) => r.poId)).toEqual(["po-2"]);
    expect(filterReceivingRows(rows, "all", "rejeki")).toHaveLength(2);
  });

  it("counts rows per status", () => {
    expect(countReceivingRows(rows)).toEqual({ in_delivery: 1, received: 1 });
  });
});

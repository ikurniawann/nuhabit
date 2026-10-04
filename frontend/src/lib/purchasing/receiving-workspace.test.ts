import { describe, expect, it } from "vitest";
import {
  mapWorkspaceDeliveries,
  mapWorkspaceGrns,
  scopeWorkspaceRows,
  type WorkspaceDeliveryRow,
  type WorkspaceGrnRow,
} from "./receiving-workspace";

function delivery(overrides: Partial<WorkspaceDeliveryRow>): WorkspaceDeliveryRow {
  return {
    id: "d-1",
    purchase_order_id: "po-1",
    supplier_id: null,
    vendor_id: null,
    nomor_resi: null,
    no_resi: null,
    no_surat_jalan: "SJ",
    kurir: null,
    tanggal_kirim: null,
    tanggal_estimasi_tiba: null,
    tanggal_aktual_tiba: null,
    status: "pending",
    created_at: null,
    ...overrides,
  };
}

function grn(overrides: Partial<WorkspaceGrnRow>): WorkspaceGrnRow {
  return {
    id: "g-1",
    nomor_grn: "GRN-1",
    delivery_id: "d-1",
    purchase_order_id: "po-1",
    supplier_id: null,
    vendor_id: null,
    tanggal_penerimaan: null,
    no_surat_jalan: null,
    status: "pending",
    total_item_diterima: 1,
    total_item_ditolak: 0,
    receive_count: null,
    catatan: null,
    created_at: null,
    ...overrides,
  };
}

describe("scopeWorkspaceRows", () => {
  it("keeps rows of the module's POs and lists ids to look up", () => {
    const scoped = scopeWorkspaceRows(
      {
        purchaseOrders: [{ id: "po-1" }, { id: "po-3" }],
        deliveries: [delivery({ supplier_id: "s-1" }), delivery({ id: "d-2", purchase_order_id: "po-2" })],
        grns: [grn({ vendor_id: "v-1" }), grn({ id: "g-2", purchase_order_id: "po-2" })],
      },
      new Set(["po-1"])
    );
    expect(scoped.deliveries.map((d) => d.id)).toEqual(["d-1"]);
    expect(scoped.grns.map((g) => g.id)).toEqual(["g-1"]);
    expect(scoped.purchaseOrders).toEqual([{ id: "po-1" }]);
    expect(scoped.poIds).toEqual(["po-1"]);
    expect(scoped.supplierIds).toEqual(["s-1"]);
    expect(scoped.vendorIds).toEqual(["v-1"]);
  });
});

describe("mapWorkspaceDeliveries / mapWorkspaceGrns", () => {
  const lookups = {
    poNumberById: new Map([["po-1", "PO-1"]]),
    supplierNameById: new Map([["s-1", "Toko A"]]),
    vendorNameById: new Map([["v-1", "Vendor B"]]),
  };

  it("labels deliveries and links GRNs to the delivery number", () => {
    const deliveries = mapWorkspaceDeliveries([delivery({ supplier_id: "s-1", nomor_resi: "R-1" })], lookups);
    expect(deliveries[0]).toMatchObject({ po_number: "PO-1", supplier_name: "Toko A", no_resi: "R-1" });

    const grns = mapWorkspaceGrns(
      [grn({ vendor_id: "v-1" }), grn({ id: "g-2", delivery_id: "d-x", purchase_order_id: "po-x" })],
      deliveries,
      lookups
    );
    expect(grns[0]).toMatchObject({ delivery_number: "R-1", po_number: "PO-1", supplier_name: "Vendor B", receive_count: 1 });
    expect(grns[1]).toMatchObject({ delivery_number: "d-x", po_number: "po-x", supplier_name: null });
  });
});

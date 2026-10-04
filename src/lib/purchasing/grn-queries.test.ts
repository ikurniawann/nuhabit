import { describe, expect, it } from "vitest";
import { mapGrnListRow } from "./grn-queries";

const row = {
  id: "grn-1",
  nomor_grn: "GRN-20261004-0001",
  delivery_id: "del-1",
  purchase_order_id: "po-1",
  supplier_id: "sup-1",
  tanggal_penerimaan: "2026-10-04",
  no_surat_jalan: "SJ-1",
  status: "received",
  total_item_diterima: 4,
  total_item_ditolak: 1,
  receive_count: null,
  catatan: null,
  created_at: "2026-10-04T01:00:00Z",
};

describe("mapGrnListRow", () => {
  it("resolves numbers and supplier names from the lookups", () => {
    const mapped = mapGrnListRow(row, {
      deliveryNumberById: new Map([["del-1", "RESI-9"]]),
      poNumberById: new Map([["po-1", "PO-1"]]),
      supplierNameById: new Map([["sup-1", "Toko A"]]),
    });
    expect(mapped).toMatchObject({
      delivery_number: "RESI-9",
      po_id: "po-1",
      po_number: "PO-1",
      supplier_name: "Toko A",
      receive_count: 1,
    });
  });

  it("falls back to ids and a dash when lookups miss", () => {
    const empty = { deliveryNumberById: new Map(), poNumberById: new Map(), supplierNameById: new Map() };
    expect(mapGrnListRow(row, empty)).toMatchObject({
      delivery_number: "del-1",
      po_number: "po-1",
      supplier_name: "—",
    });
    expect(mapGrnListRow({ ...row, delivery_id: null, supplier_id: null }, empty)).toMatchObject({
      delivery_number: null,
      supplier_name: "—",
    });
  });
});

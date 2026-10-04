import { describe, expect, it } from "vitest";
import {
  buildDeliveryUpdate,
  mapDeliveryForGrn,
  mapDeliveryListRow,
  mapPoOptions,
  poBusinessScope,
  summarizeDeliveryRefs,
  type DeliveryRow,
  type PoOptionRow,
} from "./delivery-mappers";

const delivery: DeliveryRow = {
  id: "del-1",
  purchase_order_id: "po-1",
  supplier_id: "sup-1",
  vendor_id: null,
  nomor_resi: null,
  no_resi: "RESI-1",
  no_surat_jalan: "SJ-1",
  kurir: "JNE",
  status: "pending",
};

describe("mapDeliveryListRow", () => {
  it("fills missing numbers with a dash", () => {
    expect(mapDeliveryListRow(delivery, new Map([["po-1", "PO-1"]]))).toMatchObject({
      delivery_number: "RESI-1",
      po_number: "PO-1",
      ekspedisi: "JNE",
      no_resi: "RESI-1",
    });
    expect(mapDeliveryListRow({ ...delivery, no_resi: null, kurir: null }, new Map())).toMatchObject({
      delivery_number: "-",
      po_number: "-",
      ekspedisi: "-",
      no_resi: "-",
    });
  });
});

describe("buildDeliveryUpdate", () => {
  it("maps ekspedisi to kurir and skips empty optional fields", () => {
    expect(buildDeliveryUpdate({ ekspedisi: "SiCepat", no_resi: "", tanggal_kirim: "" }, "u1")).toEqual({
      updated_by: "u1",
      kurir: "SiCepat",
      no_resi: "",
    });
  });
});

describe("summarizeDeliveryRefs", () => {
  it("normalises supplier, vendor and PO labels", () => {
    expect(
      summarizeDeliveryRefs({
        supplier: { id: "s", nama: "Lama", kode: "S-1" },
        vendor: { id: "v", name: null },
        purchaseOrder: { id: "p", po_number: "PO-9" },
      })
    ).toEqual({
      supplier: { id: "s", nama: "Lama", kode: "S-1" },
      vendor: { id: "v", nama: "-", kode: "" },
      purchase_order: { id: "p", po_number: "PO-9", status: "" },
    });
  });
});

describe("poBusinessScope", () => {
  it("falls back from PO to supplier to vendor", () => {
    const po = { company_id: null, branch_id: "b-po" } as PoOptionRow;
    expect(
      poBusinessScope(po, { id: "s", name: null, company_id: "c-sup" }, { id: "v", name: null, company_id: "c-ven" })
    ).toEqual({ company_id: "c-sup", branch_id: "b-po" });
  });
});

describe("mapPoOptions", () => {
  const orders: PoOptionRow[] = [
    { id: "po-1", nomor_po: "PO-1", supplier_id: "sup-1", vendor_id: "ven-1", status: "approved", company_id: null, branch_id: null },
    { id: "po-2", nomor_po: "PO-2", supplier_id: "sup-1", vendor_id: null, status: "sent", company_id: null, branch_id: null },
  ];
  const deliveriesByPoId = new Map([
    ["po-1", [{ id: "d-open", purchase_order_id: "po-1", status: "in_transit", nomor_resi: "R-1" }]],
    ["po-2", [{ id: "d-done", purchase_order_id: "po-2", status: "delivered", no_surat_jalan: "SJ-2" }]],
  ]);
  const base = {
    orders,
    deliveriesByPoId,
    supplierNameById: new Map([["sup-1", "Toko A"]]),
    vendorNameById: new Map([["ven-1", "Vendor B"]]),
  };

  it("hides POs with an open delivery unless includeAssigned", () => {
    const rows = mapPoOptions({ ...base, moduleType: "raw_material", includeAssigned: false });
    expect(rows.map((row) => row.id)).toEqual(["po-2"]);
    expect(rows[0]).toMatchObject({
      nama_supplier: "Toko A",
      active_delivery_id: null,
      active_delivery_number: "SJ-2",
      active_delivery_status: "delivered",
      has_open_delivery: false,
    });
  });

  it("uses vendor names for product POs", () => {
    const rows = mapPoOptions({ ...base, moduleType: "product", includeAssigned: true });
    expect(rows[0]).toMatchObject({ nama_supplier: "Vendor B", active_delivery_id: "d-open", has_open_delivery: true });
    expect(rows[1].nama_supplier).toBeNull();
  });
});

describe("mapDeliveryForGrn", () => {
  it("prefers supplier, then vendor, then courier for the party name", () => {
    const lookups = {
      supplierNameById: new Map<string, string>(),
      vendorNameById: new Map([["ven-1", "Vendor B"]]),
      poNumberById: new Map([["po-1", "PO-1"]]),
    };
    expect(mapDeliveryForGrn({ ...delivery, supplier_id: null, vendor_id: "ven-1" }, lookups)).toMatchObject({
      po_id: "po-1",
      po_number: "PO-1",
      supplier_name: "Vendor B",
      vendor_name: "Vendor B",
      delivery_number: "RESI-1",
    });
    expect(mapDeliveryForGrn({ ...delivery, supplier_id: "x", no_resi: null, no_surat_jalan: null }, lookups)).toMatchObject({
      supplier_name: "JNE",
      vendor_name: null,
      delivery_number: "del-1",
    });
  });
});

import { describe, expect, it } from "vitest";
import { buildPoItemRows, mapSkuOwnership, nextMonthlyPoNumber, parsePoCreateBody } from "@/lib/purchasing/po-create";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("nextMonthlyPoNumber", () => {
  it("starts at 0001 and increments the last sequence", () => {
    expect(nextMonthlyPoNumber("PO-202610", null)).toBe("PO-202610-0001");
    expect(nextMonthlyPoNumber("PO-202610", "PO-202610-0041")).toBe("PO-202610-0042");
  });
});

describe("mapSkuOwnership", () => {
  it("maps POS SKUs to their item product and flags variant products by active SKUs", () => {
    const { rows, variantProductIds } = mapSkuOwnership(
      [{ id: "pos-1", source_product_id: "prod-1" }],
      [
        { id: "sku-a", product_id: "pos-1", is_active: true },
        { id: "sku-x", product_id: "pos-unknown", is_active: false },
      ]
    );
    expect(rows).toEqual([
      { id: "sku-a", source_product_id: "prod-1", is_active: true },
      { id: "sku-x", source_product_id: "", is_active: false },
    ]);
    expect([...variantProductIds]).toEqual(["prod-1"]);
  });
});

describe("buildPoItemRows", () => {
  const base = { qty_ordered: 2, harga_satuan: 1000 };

  it("fills exactly one item discriminator per module", () => {
    const [product, supply, raw] = buildPoItemRows("po-1", [
      { ...base, product_id: "p", pos_sku_id: "sku" },
      { ...base, supply_item_id: "s", notes: "urgent" },
      { ...base, raw_material_id: "r", satuan_id: "u" },
    ]);
    expect(product).toMatchObject({ product_id: "p", raw_material_id: null, supply_item_id: null, pos_sku_id: "sku" });
    expect(supply).toMatchObject({ supply_item_id: "s", product_id: null, raw_material_id: null, catatan: "urgent" });
    expect(raw).toMatchObject({ raw_material_id: "r", product_id: null, satuan_id: "u", catatan: null });
    expect(raw).not.toHaveProperty("supply_item_id");
  });
});

describe("parsePoCreateBody", () => {
  it("uses the schema of the module and reports the first issue", () => {
    expect(() =>
      parsePoCreateBody({ vendor_id: UUID, tanggal_po: "2026-10-04", items: [] }, "general")
    ).toThrow("Minimal 1 item PO");
  });

  it("applies header defaults", () => {
    const input = parsePoCreateBody(
      {
        vendor_id: UUID,
        tanggal_po: "2026-10-04",
        tanggal_kirim_estimasi: "",
        items: [{ product_id: UUID, qty_ordered: 1, harga_satuan: 0 }],
      },
      "product"
    );
    expect(input).toMatchObject({
      diskon_persen: 0,
      diskon_nominal: 0,
      ppn_persen: 11,
      source_type: "manual",
      tanggal_kirim_estimasi: null,
    });
  });
});

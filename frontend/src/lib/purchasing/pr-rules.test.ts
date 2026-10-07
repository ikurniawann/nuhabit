import { describe, expect, it } from "vitest";
import { buildPoLinesFromPr } from "@/lib/purchasing/pr-convert";
import { resolvePrScope } from "@/lib/purchasing/pr-queries";
import { buildPrPermissions, canEditPrOf, isAwaitingPrApproval } from "@/lib/purchasing/pr-roles";
import { buildPrItemRows } from "@/lib/purchasing/pr-workflow";

describe("PR access rules", () => {
  it("editor list and approval status", () => {
    expect(canEditPrOf("u1", { id: "u1", role: "cashier" })).toBe(true);
    expect(canEditPrOf("u1", { id: "u2", role: "purchasing_admin" })).toBe(true);
    expect(canEditPrOf("u1", { id: "u2", role: "purchasing_staff" })).toBe(false);
    expect(isAwaitingPrApproval("pending_head")).toBe(true);
    expect(isAwaitingPrApproval("pending_finance")).toBe(false);
  });

  it("detail permissions follow status and the approval grant", () => {
    const staff = { id: "u2", role: "purchasing_staff" };
    expect(buildPrPermissions({ status: "approved", requester_id: "u1" }, staff, true)).toEqual({
      canEdit: false,
      canApprove: false,
      canCreatePO: true,
    });
    expect(
      buildPrPermissions({ status: "approved", requester_id: "u1", converted_po_id: "po-1" }, staff, false)
        .canCreatePO
    ).toBe(false);
    expect(buildPrPermissions({ status: "draft", requester_id: "u2" }, staff, false).canEdit).toBe(true);
    expect(buildPrPermissions({ status: "pending_head", requester_id: "u1" }, staff, true).canApprove).toBe(true);
    expect(buildPrPermissions({ status: "pending_head", requester_id: "u1" }, staff, false).canApprove).toBe(false);
  });
});

describe("resolvePrScope", () => {
  it("falls back to the requester scope for legacy PRs", () => {
    expect(
      resolvePrScope({ id: "pr", requester_id: "u", company_id: null, branch_id: "b-pr" }, {
        id: "u",
        full_name: "U",
        company_id: "c-user",
        branch_id: "b-user",
      })
    ).toEqual({ company_id: "c-user", branch_id: "b-pr" });
  });
});

describe("buildPrItemRows", () => {
  it("nulls the discriminators the item does not carry", () => {
    const [row] = buildPrItemRows("pr-1", [
      { supply_item_id: "s1", description: "Tisu", qty: 2, unit: "pak", estimated_price: 5000, total: 10_000 },
    ]);
    expect(row).toEqual({
      pr_id: "pr-1",
      product_id: null,
      raw_material_id: null,
      supply_item_id: "s1",
      satuan_id: null,
      description: "Tisu",
      qty: 2,
      unit: "pak",
      estimated_price: 5000,
      total: 10_000,
    });
  });
});

describe("buildPoLinesFromPr", () => {
  const item = { id: "i1", raw_material_id: "rm-1", satuan_id: "u1", qty: 3, estimated_price: 9000, description: "Gula" };

  it("uses the rounded supplier price history when present, else the PR estimate", () => {
    expect(buildPoLinesFromPr("po-1", [item], new Map([["rm-1", 8_499.6]]))[0].harga_satuan).toBe(8_500);
    expect(buildPoLinesFromPr("po-1", [item], new Map())[0]).toMatchObject({
      purchase_order_id: "po-1",
      pr_item_id: "i1",
      qty_ordered: 3,
      harga_satuan: 9000,
      diskon_item: 0,
      catatan: "Gula",
    });
  });

  it("rejects PR items without a raw material", () => {
    expect(() => buildPoLinesFromPr("po-1", [{ ...item, raw_material_id: null }], new Map())).toThrow(
      "Item PR belum terhubung ke master bahan baku"
    );
  });
});

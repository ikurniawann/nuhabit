import { describe, expect, it } from "vitest";
import {
  resolvePosSellScope,
  assertProductWarehousesMatchStall,
  posCartHasItems,
  resolvePosSellStall,
} from "./pos-sell-stall";

describe("resolvePosSellStall", () => {
  it("uses active stall cookie when mode is stall", () => {
    expect(
      resolvePosSellStall({
        activeMode: "stall",
        activeStallId: "w-a",
        assignedWarehouseIds: ["w-a", "w-b"],
      })
    ).toEqual({ ok: true, warehouseId: "w-a" });
  });

  it("rejects Semua Stall mode", () => {
    const result = resolvePosSellStall({
      activeMode: "all",
      activeStallId: null,
      assignedWarehouseIds: ["w-a"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("all_stalls");
  });

  it("falls back to sole assignment when cookie unset", () => {
    expect(
      resolvePosSellStall({
        activeMode: "unset",
        activeStallId: null,
        assignedWarehouseIds: ["w-only"],
      })
    ).toEqual({ ok: true, warehouseId: "w-only" });
  });

  it("uses default warehouse when cookie is unset", () => {
    expect(
      resolvePosSellStall({
        activeMode: "unset",
        activeStallId: null,
        assignedWarehouseIds: ["w-1", "w-2"],
        defaultWarehouseId: "w-1",
      })
    ).toEqual({ ok: true, warehouseId: "w-1" });
  });

  it("rejects multi assignment without explicit stall", () => {
    const result = resolvePosSellStall({
      activeMode: "unset",
      activeStallId: null,
      assignedWarehouseIds: ["w-a", "w-b"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("multiple_unselected");
  });

  it("rejects empty assignment", () => {
    const result = resolvePosSellStall({
      activeMode: "unset",
      activeStallId: null,
      assignedWarehouseIds: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no_stall");
  });
});

describe("posCartHasItems", () => {
  it("detects non-empty cart JSON", () => {
    expect(posCartHasItems(JSON.stringify({ items: [{ id: "1" }] }))).toBe(true);
  });

  it("treats empty items / invalid JSON as empty", () => {
    expect(posCartHasItems(JSON.stringify({ items: [] }))).toBe(false);
    expect(posCartHasItems(null)).toBe(false);
    expect(posCartHasItems("not-json")).toBe(false);
  });
});

describe("assertProductWarehousesMatchStall", () => {
  it("accepts all items from the sell stall", () => {
    expect(assertProductWarehousesMatchStall(["w-a", "w-a"], "w-a")).toEqual({ ok: true });
  });

  it("rejects foreign or missing stall products", () => {
    expect(assertProductWarehousesMatchStall(["w-a", "w-b"], "w-a").ok).toBe(false);
    expect(assertProductWarehousesMatchStall([null], "w-a").ok).toBe(false);
  });
});

/**
 * Mode jual "Semua Stall" (permintaan owner 2026-08-16): kasir ber-akses
 * penuh boleh menampilkan katalog seluruh stall dan menjual lintas stall
 * dalam SATU transaksi. Kontrak:
 * - allStallsAllowed=false → perilaku lama persis (satu stall wajib).
 * - allStallsAllowed=true + cookie "all"/unset tanpa penempatan → mode "all".
 * - Cookie stall tertentu tetap menang walau allStallsAllowed=true.
 */
describe("resolvePosSellScope — mode Semua Stall", () => {
  it("cookie 'all' + allStallsAllowed → mode all", () => {
    const result = resolvePosSellScope({
      activeMode: "all",
      activeStallId: null,
      assignedWarehouseIds: [],
      allStallsAllowed: true,
    });
    expect(result).toEqual({ mode: "all" });
  });

  it("cookie 'all' tanpa izin → tetap diblok seperti dulu", () => {
    const result = resolvePosSellScope({
      activeMode: "all",
      activeStallId: null,
      assignedWarehouseIds: ["w-a"],
      allStallsAllowed: false,
    });
    expect(result.mode).toBe("blocked");
    if (result.mode === "blocked") expect(result.reason).toBe("all_stalls");
  });

  it("cookie stall tertentu tetap menang meski boleh semua stall", () => {
    const result = resolvePosSellScope({
      activeMode: "stall",
      activeStallId: "w-b",
      assignedWarehouseIds: ["w-a", "w-b"],
      allStallsAllowed: true,
    });
    expect(result).toEqual({ mode: "stall", warehouseId: "w-b" });
  });

  it("unset + tanpa penempatan + allStallsAllowed → mode all (super admin default)", () => {
    const result = resolvePosSellScope({
      activeMode: "unset",
      activeStallId: null,
      assignedWarehouseIds: [],
      allStallsAllowed: true,
    });
    expect(result).toEqual({ mode: "all" });
  });

  it("unset dengan default warehouse → tetap stall itu (bukan all)", () => {
    const result = resolvePosSellScope({
      activeMode: "unset",
      activeStallId: null,
      assignedWarehouseIds: ["w-a"],
      defaultWarehouseId: "w-a",
      allStallsAllowed: true,
    });
    expect(result).toEqual({ mode: "stall", warehouseId: "w-a" });
  });
});

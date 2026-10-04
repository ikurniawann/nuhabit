import { beforeEach, describe, expect, it, vi } from "vitest";

let activeStallId: string | null = null;

vi.mock("@/lib/auth/require-user", () => ({
  getUser: vi.fn(async () => ({
    user: activeStallId === undefined ? null : { id: "u1", active_stall_id: activeStallId },
    db: null,
  })),
}));

const STALL = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

async function load() {
  vi.resetModules();
  return import("./stall-scope");
}

describe("getApiStallScope", () => {
  beforeEach(() => {
    activeStallId = null;
  });

  it('mengembalikan mode "stall" saat ada stall aktif', async () => {
    activeStallId = STALL;
    const { getApiStallScope } = await load();
    expect(await getApiStallScope()).toEqual({ mode: "stall", warehouseId: STALL });
  });

  it('mengembalikan mode "all" saat tidak ada stall aktif', async () => {
    const { getApiStallScope } = await load();
    expect(await getApiStallScope()).toEqual({ mode: "all" });
  });
});

describe("resolveWarehouseFilter", () => {
  beforeEach(() => {
    activeStallId = null;
  });

  it("mengutamakan filter eksplisit dari pemanggil", async () => {
    activeStallId = STALL;
    const { resolveWarehouseFilter } = await load();
    expect(await resolveWarehouseFilter(OTHER)).toBe(OTHER);
  });

  it("jatuh ke stall aktif saat pemanggil tidak memberi filter", async () => {
    activeStallId = STALL;
    const { resolveWarehouseFilter } = await load();
    expect(await resolveWarehouseFilter(undefined)).toBe(STALL);
    expect(await resolveWarehouseFilter(null)).toBe(STALL);
    expect(await resolveWarehouseFilter("")).toBe(STALL);
  });

  it("mengembalikan null saat mode Semua Stall dan tanpa filter eksplisit", async () => {
    const { resolveWarehouseFilter } = await load();
    expect(await resolveWarehouseFilter(undefined)).toBeNull();
  });
});

describe("rawMaterialStockSource", () => {
  beforeEach(() => {
    activeStallId = null;
  });

  it("memakai view berdimensi warehouse saat satu stall dipilih", async () => {
    activeStallId = STALL;
    const { rawMaterialStockSource } = await load();
    expect(await rawMaterialStockSource()).toEqual({
      view: "v_raw_materials_stock_by_warehouse",
      warehouseId: STALL,
    });
  });

  it("memakai view agregat tanpa filter pada mode Semua Stall", async () => {
    const { rawMaterialStockSource } = await load();
    expect(await rawMaterialStockSource()).toEqual({
      view: "v_raw_materials_stock",
      warehouseId: null,
    });
  });
});

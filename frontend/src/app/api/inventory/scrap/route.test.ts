import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/auth";

const requireIamMenuPrefix = vi.fn();
vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return { ...actual, requireIamMenuPrefix: (...args: unknown[]) => requireIamMenuPrefix(...args) };
});

const validateWarehouse = vi.fn();
vi.mock("@/lib/api/scope", () => ({
  getApiUserScope: vi.fn(async () => null),
  validateWarehouseForReceivingScope: (...args: unknown[]) => validateWarehouse(...args),
}));

const scrapStock = vi.fn();
vi.mock("@/lib/inventory/scrap", () => ({ scrapStock: (...args: unknown[]) => scrapStock(...args) }));
vi.mock("@/lib/inventory/stock-queries", () => ({ listMovements: vi.fn() }));

const RM = "11111111-1111-4111-8111-111111111111";
const WH = "22222222-2222-4222-8222-222222222222";
const body = { raw_material_id: RM, warehouse_id: WH, qty: 2, reason: "expired" };

function post(payload: unknown): NextRequest {
  return { json: async () => payload, headers: new Headers() } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireIamMenuPrefix.mockResolvedValue({ id: "u-1", full_name: "Gudang" });
  validateWarehouse.mockResolvedValue({ branch_id: "b-1" });
});

describe("POST /api/inventory/scrap", () => {
  it("403 dari guard IAM", async () => {
    requireIamMenuPrefix.mockRejectedValue(ApiError.forbidden());
    const { POST } = await import("./route");
    expect((await POST(post(body))).status).toBe(403);
  });

  it("400 bila qty bukan positif", async () => {
    const { POST } = await import("./route");
    const res = await POST(post({ ...body, qty: 0 }));
    expect(res.status).toBe(400);
    expect(scrapStock).not.toHaveBeenCalled();
  });

  it("400 bila gudang di luar scope", async () => {
    validateWarehouse.mockResolvedValue({ error: "forbidden" });
    const { POST } = await import("./route");
    const res = await POST(post(body));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Gudang tidak valid atau di luar cabang Anda");
  });

  it("409 dari aturan scrap sampai ke klien", async () => {
    scrapStock.mockRejectedValue(ApiError.conflict("Stok tidak cukup"));
    const { POST } = await import("./route");
    const res = await POST(post(body));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Stok tidak cukup");
  });

  it("201 dengan catatan jurnal di pesan", async () => {
    scrapStock.mockResolvedValue({ reference_number: "SCR-1", qty: 2, accounting_note: "jurnal belum dipetakan" });
    const { POST } = await import("./route");
    const res = await POST(post(body));
    expect(res.status).toBe(201);
    expect((await res.json()).message).toBe("Scrap SCR-1 tercatat, stok berkurang 2 (jurnal belum dipetakan)");
  });
});

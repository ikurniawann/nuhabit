// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const importRawMaterials = vi.fn();

vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return { ...actual, requireIamMenuPrefix: vi.fn(async () => ({ id: "user-1" })) };
});
vi.mock("@/lib/api/scope", () => ({
  getApiUserScope: vi.fn(async () => null),
  importBusinessIds: vi.fn(() => ({ companyId: "c-1", branchId: "b-1" })),
}));
vi.mock("@/lib/purchasing/import-raw-materials", () => ({
  importRawMaterials: (...args: unknown[]) => importRawMaterials(...args),
}));
vi.mock("@/lib/pg/create-client", () => ({ createServerPgClient: vi.fn(async () => ({})) }));

import { POST } from "./route";

function upload(file?: File): NextRequest {
  const form = new FormData();
  if (file) form.append("file", file);
  return { formData: async () => form } as unknown as NextRequest;
}

describe("POST /api/purchasing/import/raw-materials", () => {
  beforeEach(() => vi.clearAllMocks());

  it("400 without a file", async () => {
    const res = await POST(upload());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: "File not found" });
  });

  it("400 when the file has no data rows", async () => {
    const res = await POST(upload(new File(["kode,nama\n"], "bahan.csv")));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("File must include a header row and at least one data row");
    expect(importRawMaterials).not.toHaveBeenCalled();
  });

  it("parses CSV headers through the aliases and returns the import summary", async () => {
    const summary = { success: true, imported: 1, updated: 0, skipped: 0, errors: [] };
    importRawMaterials.mockResolvedValue(summary);

    const res = await POST(upload(new File(["Name,Purchase Unit,Stok Awal\nGula,KG,5\n"], "bahan.csv")));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(summary);

    const [, rows, scope] = importRawMaterials.mock.calls[0];
    expect(rows).toEqual([{ rowNumber: 2, data: { nama: "Gula", satuan_besar_kode: "KG", opening_stock: "5" } }]);
    expect(scope).toEqual({ userId: "user-1", companyId: "c-1", branchId: "b-1" });
  });
});

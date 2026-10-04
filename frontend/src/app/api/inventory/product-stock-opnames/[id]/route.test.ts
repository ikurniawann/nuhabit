// EPIC-047 Fase 3 — security fix: GET/PATCH .../product-stock-opnames/[id]
// TIDAK boleh mengonfirmasi keberadaan opname milik company/branch lain.
// fetchProductStockOpnameDetail(id) sendiri tanpa predikat scope, jadi route
// WAJIB menolak dengan `isOpnameInScope` sebelum mengembalikan data —
// respons 404 (SAMA persis shape-nya dengan "not found" biasa), bukan 403.
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { UserScope } from "@/lib/api/scope";

vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return {
    ...actual,
    requireIamMenuPrefix: vi.fn(async () => ({ id: "user-1", role: "admin" })),
  };
});

let scopeRef: UserScope | null = {
  userId: "user-1",
  role: "super_admin",
  businessScope: null,
  holdingId: null,
  companyId: null,
  branchId: null,
  isUnscoped: true,
};

vi.mock("@/lib/api/scope", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/scope")>();
  return {
    ...actual,
    getApiUserScope: vi.fn(async () => scopeRef),
  };
});

type Detail = {
  id: string;
  opname_number: string;
  company_id: string | null;
  branch_id: string | null;
  status: string;
  lines: unknown[];
};

let detailRef: Detail | null;

const fetchProductStockOpnameDetailMock = vi.fn(async () => detailRef);
vi.mock("@/lib/inventory/product-stock-opname", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/inventory/product-stock-opname")>();
  return {
    ...actual,
    fetchProductStockOpnameDetail: (...args: unknown[]) =>
      (fetchProductStockOpnameDetailMock as unknown as (...a: unknown[]) => unknown)(...args),
  };
});

function makeParams(id = "opname-1") {
  return { params: Promise.resolve({ id }) };
}

function makeRequest(body: unknown = {}): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  scopeRef = {
    userId: "user-1",
    role: "super_admin",
    businessScope: null,
    holdingId: null,
    companyId: null,
    branchId: null,
    isUnscoped: true,
  };
});

describe("GET /api/inventory/product-stock-opnames/[id] — scope guard", () => {
  it("caller ber-scope dari company lain → 404 (bukan 403, tidak konfirmasi eksistensi)", async () => {
    detailRef = {
      id: "opname-1",
      opname_number: "POPN-2026-001",
      company_id: "company-owner",
      branch_id: null,
      status: "in_progress",
      lines: [],
    };
    scopeRef = {
      userId: "user-2",
      role: "company_admin",
      businessScope: "company",
      holdingId: null,
      companyId: "company-other",
      branchId: null,
      isUnscoped: false,
    };

    const { GET } = await import("./route");
    const res = await GET({} as NextRequest, makeParams("opname-1"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/tidak ditemukan/);
  });

  it("caller unscoped (super_admin) → tetap bisa lihat opname company manapun", async () => {
    detailRef = {
      id: "opname-1",
      opname_number: "POPN-2026-001",
      company_id: "company-owner",
      branch_id: null,
      status: "in_progress",
      lines: [],
    };

    const { GET } = await import("./route");
    const res = await GET({} as NextRequest, makeParams("opname-1"));
    expect(res.status).toBe(200);
  });
});

describe("PATCH /api/inventory/product-stock-opnames/[id] — scope guard", () => {
  it("caller ber-scope dari company lain → 404 (bukan 403, tidak konfirmasi eksistensi)", async () => {
    detailRef = {
      id: "opname-1",
      opname_number: "POPN-2026-001",
      company_id: "company-owner",
      branch_id: null,
      status: "in_progress",
      lines: [],
    };
    scopeRef = {
      userId: "user-2",
      role: "company_admin",
      businessScope: "company",
      holdingId: null,
      companyId: "company-other",
      branchId: null,
      isUnscoped: false,
    };

    const { PATCH } = await import("./route");
    const res = await PATCH(makeRequest({ notes: "hack attempt" }), makeParams("opname-1"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/tidak ditemukan/);
  });
});

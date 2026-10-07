// EPIC-047 Fase 1A (attempt-3 security gate) — regresi untuk
// POST /api/pos/products/[id]/skus/matrix: bentuk input rusak & matriks
// raksasa harus 400 sebelum expandMatrix/withTransaction pernah dipanggil
// (S1/S3), barcode gabungan >64 harus 400 PRA-transaksi (S2), dan urutan
// gerbang merchandise harus lebih dulu dari validasi body (S4).
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

type MockProduct = { id: string; sku: string; name: string; product_kind: string } | null;

let mockProduct: MockProduct = {
  id: "p1",
  sku: "KAOS-001",
  name: "Kaos Polos",
  product_kind: "merchandise",
};

vi.mock("@/lib/api/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/auth")>()),
  getPosSession: vi.fn(async () => "user-1"),
  // Matriks SKU = tulis katalog → gerbang izin aksi IAM (create pos.catalog.products).
  requireIamAction: vi.fn(async () => ({ id: "user-1" })),
}));

vi.mock("@/lib/pg/create-client", () => ({
  createPgClient: vi.fn(() => ({
    from: () => {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.maybeSingle = async () => ({ data: mockProduct, error: null });
      return builder;
    },
  })),
}));

const withTransactionMock = vi.fn(async () => {
  throw new Error("withTransaction tidak seharusnya dipanggil di test ini");
});
vi.mock("@/lib/db", () => ({
  withTransaction: (...args: unknown[]) =>
    (withTransactionMock as unknown as (...a: unknown[]) => unknown)(...args),
}));

vi.mock("@/lib/pos/merchandise-variants", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pos/merchandise-variants")>();
  return {
    ...actual,
    // Spy yang tetap memanggil implementasi asli — dipakai untuk
    // memastikan route TIDAK PERNAH memanggilnya saat validasi ukuran
    // matriks gagal (S1), bukan untuk mengubah perilakunya.
    expandMatrix: vi.fn(actual.expandMatrix),
  };
});

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function makeParams(id = "p1") {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/pos/products/[id]/skus/matrix — security gate (attempt-3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProduct = { id: "p1", sku: "KAOS-001", name: "Kaos Polos", product_kind: "merchandise" };
  });

  it("(1) values non-array (angka) — 400, bukan 500", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({ axes: [{ key: "ukuran", values: 123 }] }),
      makeParams()
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("Nilai sumbu harus berupa daftar");
  });

  it("(2) matriks kebesaran (5 sumbu x 40 nilai) — 400 & expandMatrix TIDAK dipanggil", async () => {
    const { POST } = await import("./route");
    const { expandMatrix } = await import("@/lib/pos/merchandise-variants");
    const axes = Array.from({ length: 5 }, (_, axisIndex) => ({
      key: `sumbu${axisIndex}`,
      values: Array.from({ length: 40 }, (_, valueIndex) => `v${axisIndex}-${valueIndex}`),
    }));
    const res = await POST(makeRequest({ axes }), makeParams());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("Maksimal 500 kombinasi varian per produk");
    expect(vi.mocked(expandMatrix)).not.toHaveBeenCalled();
  });

  it("(3) barcode gabungan (prefix + kode SKU) > 64 karakter — 400 SEBELUM withTransaction dipanggil", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        axes: [{ key: "ukuran", values: ["X".repeat(60)] }],
        barcode_prefix: "P".repeat(20),
      }),
      makeParams()
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("Barcode gabungan melebihi 64 karakter; perpendek prefix");
    expect(withTransactionMock).not.toHaveBeenCalled();
  });

  it("(4) produk bukan merchandise — 400 'Varian SKU hanya untuk produk merchandise' (sebelum validasi body)", async () => {
    mockProduct = { id: "p1", sku: "REG-001", name: "Produk Reguler", product_kind: "regular" };
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({ axes: [{ key: "ukuran", values: ["M"] }] }),
      makeParams()
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("Varian SKU hanya untuk produk merchandise");
    expect(withTransactionMock).not.toHaveBeenCalled();
  });

  it("(5) produk tidak ditemukan — 404 (product check mendahului validasi ukuran matriks, S4)", async () => {
    mockProduct = null;
    const { POST } = await import("./route");
    const axes = Array.from({ length: 5 }, (_, axisIndex) => ({
      key: `sumbu${axisIndex}`,
      values: Array.from({ length: 40 }, (_, valueIndex) => `v${axisIndex}-${valueIndex}`),
    }));
    const res = await POST(makeRequest({ axes }), makeParams("unknown-id"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("Produk tidak ditemukan");
    expect(withTransactionMock).not.toHaveBeenCalled();
  });
});

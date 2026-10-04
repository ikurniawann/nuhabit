// POST /api/sales-funnel/quotations/[id]/realize — kontrak 409 kekurangan
// stok (`shortages`/`warnings` di level atas, dibaca realize-dialog) dan
// pemotongan stok gudang terbesar dulu.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const db = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn(), withTransaction: vi.fn() }));
const client = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("@/lib/db", () => db);
vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/auth")>()),
  getApiUser: vi.fn(async () => ({ id: "ops-1", full_name: "Ops", role: "super_admin", brand_id: null })),
}));
vi.mock("@/lib/iam/has-menu", () => ({ userHasIamPrefix: vi.fn(async () => true) }));
vi.mock("@/lib/api/scope", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/scope")>()),
  getApiUserScope: vi.fn(async () => null),
}));

import { POST } from "./route";

const QUOTATION_ID = "55555555-5555-4555-8555-555555555555";
const params = { params: Promise.resolve({ id: QUOTATION_ID }) };

function realize(body?: unknown) {
  return POST(
    new NextRequest(`http://localhost/api/sales-funnel/quotations/${QUOTATION_ID}/realize`, {
      method: "POST",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    params
  );
}

/** Urutan query di dalam transaksi realizeQuotation. */
function mockTransaction(stock: Array<{ id: string; qty_available: string }>) {
  client.query
    .mockResolvedValueOnce({ rows: [{ status: "diterima", stock_deducted_at: null, quote_number: "QT-2610-0007" }] })
    .mockResolvedValueOnce({ rows: [{ raw_material_id: "gula", needed: "6" }] })
    .mockResolvedValueOnce({ rows: [{ name: "Kue Tanpa Resep" }] })
    .mockResolvedValueOnce({
      rows: stock.map((row) => ({ ...row, raw_material_id: "gula", warehouse_id: `wh-${row.id}` })),
    });
}

beforeEach(() => {
  vi.clearAllMocks();
  client.query.mockReset();
  db.withTransaction.mockImplementation(async (fn: (c: typeof client) => unknown) => fn(client));
  db.queryOne
    .mockResolvedValueOnce({ id: QUOTATION_ID, deal_id: "deal-1", status: "diterima", stock_deducted_at: null })
    .mockResolvedValueOnce({ id: "deal-1", company_id: "c1", branch_id: "b1", owner_user_id: null });
});

describe("POST realize", () => {
  it("404 bila quotation tidak ada", async () => {
    db.queryOne.mockReset().mockResolvedValueOnce(null);
    const res = await realize();
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Quotation tidak ditemukan");
  });

  it("409 membawa shortages & warnings di level atas body", async () => {
    mockTransaction([{ id: "a", qty_available: "2" }]);
    client.query.mockResolvedValueOnce({ rows: [{ kode: "GL-01", nama: "Gula Pasir", satuan: "gr" }] });
    const res = await realize();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      success: false,
      error: "Stok bahan baku tidak mencukupi",
      shortages: [{ raw_material_id: "gula", needed: 6, available: 2, kode: "GL-01", nama: "Gula Pasir", satuan: "gr" }],
      warnings: ['Produk "Kue Tanpa Resep" belum punya resep — tidak ada bahan yang dipotong untuknya'],
    });
  });

  it("memotong gudang terbesar dulu lalu membekukan quotation", async () => {
    mockTransaction([
      { id: "a", qty_available: "4" },
      { id: "b", qty_available: "5" },
    ]);
    client.query.mockResolvedValue({ rows: [] });
    const res = await realize({ force_skip_bom: false });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({ bomStatus: "terpotong", movedCount: 2 });
    expect(body.message).toBe("Realisasi selesai — 2 pergerakan stok dicatat");

    const updates = client.query.mock.calls.filter(([sql]) => String(sql).includes("UPDATE inventory.inventory"));
    expect(updates.map(([, values]) => values)).toEqual([
      [0, "ops-1", "b"],
      [3, "ops-1", "a"],
    ]);
    const freeze = client.query.mock.calls.at(-1);
    expect(freeze?.[1]).toEqual(["terpotong", "ops-1", QUOTATION_ID]);
  });
});

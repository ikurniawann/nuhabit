import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => queryMock(...args),
  queryOne: vi.fn(),
}));

const {
  additionalCostSchema,
  createAdditionalCost,
  deleteAdditionalCost,
  landedCostIdr,
  landedCostRates,
  listAdditionalCosts,
  loadLandedRates,
} = await import("./cogs-additional-cost");

beforeEach(() => queryMock.mockReset());

describe("landedCostRates (same cases as the Go domain test)", () => {
  const lines = [
    { grn_id: "g1", po_id: "p1", material_id: "rice", value: 1200000 },
    { grn_id: "g1", po_id: "p1", material_id: "sugar", value: 600000 },
    { grn_id: "g2", po_id: "p1", material_id: "rice", value: 200000 },
    { grn_id: "g0", po_id: "p0", material_id: "rice", value: 600000 },
  ];
  const totals = new Map([
    ["GRN:g1", 2000000],
    ["GRN:g2", 200000],
    ["PO:p1", 2200000],
    ["GRN:g0", 600000],
    ["PO:p0", 600000],
  ]);
  const costs = [
    { reference_type: "GRN", reference_id: "g1", amount: 100000 },
    { reference_type: "PO", reference_id: "p1", amount: 22000 },
    { reference_type: "GRN", reference_id: "missing", amount: 5000 },
  ];

  it("allocates each cost to its document's received lines by value", () => {
    const rates = landedCostRates(costs, lines, totals);
    expect(rates.size).toBe(2);
    expect(rates.get("rice")).toBeCloseTo(74000 / 2000000, 12);
    expect(rates.get("sugar")).toBeCloseTo(36000 / 600000, 12);
  });

  it("is empty without costs or receipts", () => {
    expect(landedCostRates([], lines, totals).size).toBe(0);
    expect(landedCostRates(costs, [], new Map()).size).toBe(0);
  });

  it("converts to rupiah rounded to cents", () => {
    expect(landedCostIdr(1250.5, 15873.25)).toBe(19849499.13);
  });
});

describe("additionalCostSchema", () => {
  it("defaults currency and rate and rejects unknown references", () => {
    const parsed = additionalCostSchema.parse({
      reference_type: "GRN",
      reference_id: "11111111-1111-4111-8111-111111111111",
      tipe_biaya: "duty",
      jumlah: 5000,
    });
    expect(parsed).toMatchObject({ currency: "IDR", exchange_rate: 1 });
    expect(additionalCostSchema.safeParse({ ...parsed, reference_type: "SO" }).success).toBe(false);
    expect(additionalCostSchema.safeParse({ ...parsed, jumlah: 0 }).success).toBe(false);
    expect(additionalCostSchema.safeParse({ ...parsed, tanggal_transaksi: "04/10/2026" }).success).toBe(false);
  });
});

const GRN = "22222222-2222-4222-8222-222222222222";
const PO = "33333333-3333-4333-8333-333333333333";
const costRow = {
  id: "c1",
  reference_type: "GRN",
  reference_id: GRN,
  tipe_biaya: "freight",
  deskripsi: "Ongkir",
  jumlah: "10.00",
  currency: "USD",
  exchange_rate: "1200.000000",
  jumlah_idr: "12000.00",
  tanggal_transaksi: "2026-10-03",
  catatan: null,
  created_at: new Date("2026-10-04T03:00:00Z"),
  created_by_name: "Staff",
};

describe("additional cost store", () => {
  it("creates a cost on an existing GRN and answers it with its number", async () => {
    queryMock
      .mockResolvedValueOnce([{ key: `GRN:${GRN}`, number: "GRN-1" }]) // document check
      .mockResolvedValueOnce([{ id: "c1" }]) // insert
      .mockResolvedValueOnce([costRow]) // re-read
      .mockResolvedValueOnce([{ key: `GRN:${GRN}`, number: "GRN-1" }]); // its number
    const created = await createAdditionalCost("user-1", {
      reference_type: "GRN",
      reference_id: GRN,
      tipe_biaya: "freight",
      jumlah: 10,
      currency: "USD",
      exchange_rate: 1200,
      deskripsi: "Ongkir",
      tanggal_transaksi: "2026-10-03",
    });
    expect(created).toMatchObject({ id: "c1", reference_number: "GRN-1", jumlah_idr: "12000.00" });
    expect(Object.keys(created)).toEqual([
      "id",
      "reference_type",
      "reference_id",
      "reference_number",
      "tipe_biaya",
      "deskripsi",
      "jumlah",
      "currency",
      "exchange_rate",
      "jumlah_idr",
      "tanggal_transaksi",
      "catatan",
      "created_at",
      "created_by_name",
    ]);
    const insertParams = queryMock.mock.calls[1][1] as unknown[];
    expect(insertParams.slice(0, 8)).toEqual(["GRN", GRN, "freight", "Ongkir", 10, "USD", 1200, 12000]);
  });

  it("404 when the PO does not exist", async () => {
    queryMock.mockResolvedValueOnce([]);
    await expect(
      createAdditionalCost("user-1", {
        reference_type: "PO",
        reference_id: PO,
        tipe_biaya: "freight",
        jumlah: 1,
        currency: "IDR",
        exchange_rate: 1,
      })
    ).rejects.toMatchObject({ status: 404, message: "PO tidak ditemukan" });
  });

  it("filters the list by reference and rejects a bad id", async () => {
    queryMock.mockResolvedValueOnce([]);
    expect(await listAdditionalCosts({ reference_type: "PO", reference_id: PO, tipe_biaya: null })).toEqual([]);
    expect(queryMock.mock.calls[0][0]).toContain("c.reference_type = $1 AND c.reference_id = $2::uuid");
    await expect(listAdditionalCosts({ reference_type: null, reference_id: "x", tipe_biaya: null })).rejects.toMatchObject({
      status: 400,
    });
  });

  it("soft-deletes once", async () => {
    queryMock.mockResolvedValueOnce([{ id: "c1" }]).mockResolvedValueOnce([]);
    await deleteAdditionalCost("user-1", "11111111-1111-4111-8111-111111111111");
    await expect(deleteAdditionalCost("user-1", "11111111-1111-4111-8111-111111111111")).rejects.toMatchObject({
      status: 404,
      message: "Biaya tambahan tidak ditemukan",
    });
  });

  it("loads landed cost rates from receipts and active costs", async () => {
    queryMock
      .mockResolvedValueOnce([{ grn_id: GRN, po_id: PO, material_id: "rm", value: 120000 }])
      .mockResolvedValueOnce([
        { key: `GRN:${GRN}`, value: 120000 },
        { key: `PO:${PO}`, value: 120000 },
      ])
      .mockResolvedValueOnce([{ reference_type: "GRN", reference_id: GRN, amount: 12000 }]);
    const rates = await loadLandedRates(["rm"]);
    expect(rates.get("rm")).toBeCloseTo(0.1, 12);
  });
});

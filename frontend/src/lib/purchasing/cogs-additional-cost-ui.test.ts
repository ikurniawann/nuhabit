import { describe, expect, it } from "vitest";
import { buildAdditionalCostPayload, emptyAdditionalCostForm, sumCostsIdr } from "./cogs-additional-cost-ui";

const GRN = "22222222-2222-4222-8222-222222222222";

describe("additional cost form", () => {
  const form = { ...emptyAdditionalCostForm("2026-10-04"), reference_id: GRN, jumlah: 150000, deskripsi: "  Ongkir JNE " };

  it("builds the API payload, IDR at rate 1", () => {
    expect(buildAdditionalCostPayload({ ...form, exchange_rate: 99 })).toEqual({
      payload: {
        reference_type: "GRN",
        reference_id: GRN,
        tipe_biaya: "freight",
        jumlah: 150000,
        currency: "IDR",
        exchange_rate: 1,
        tanggal_transaksi: "2026-10-04",
        deskripsi: "Ongkir JNE",
      },
    });
  });

  it("keeps the rate of a foreign currency and drops an empty description", () => {
    const built = buildAdditionalCostPayload({ ...form, currency: "usd", exchange_rate: 15800, deskripsi: " " });
    expect(built).toEqual({ payload: expect.objectContaining({ currency: "USD", exchange_rate: 15800 }) });
    expect("payload" in built && "deskripsi" in built.payload).toBe(false);
  });

  it("explains what is missing", () => {
    expect(buildAdditionalCostPayload({ ...form, reference_id: "" })).toEqual({ error: "Pilih GRN terlebih dahulu" });
    expect(buildAdditionalCostPayload({ ...form, jumlah: 0 })).toEqual({ error: "Nominal harus lebih dari 0" });
    expect(buildAdditionalCostPayload({ ...form, currency: "US" })).toEqual({ error: "Mata uang harus 3 huruf, mis. IDR atau USD" });
    expect(buildAdditionalCostPayload({ ...form, currency: "USD", exchange_rate: null })).toEqual({
      error: "Kurs ke Rupiah harus lebih dari 0",
    });
  });

  it("totals the rupiah amounts", () => {
    expect(sumCostsIdr([{ jumlah_idr: "12000.00" }, { jumlah_idr: "500.50" }])).toBe(12500.5);
  });
});

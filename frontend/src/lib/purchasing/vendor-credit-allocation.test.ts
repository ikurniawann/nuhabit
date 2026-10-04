import { describe, expect, it } from "vitest";
import { allocateCredits, creditRemaining, type VendorCreditBalance } from "./vendor-credit-allocation";

const TODAY = "2026-10-03";

function credit(id: string, date: string, total: number, extra: Partial<VendorCreditBalance> = {}): VendorCreditBalance {
  return {
    id,
    credit_number: `VC-${id}`,
    credit_date: date,
    total_amount: total,
    applied_amount: 0,
    status: "approved",
    expiry_date: null,
    ...extra,
  };
}

describe("allocateCredits", () => {
  it("memakai kredit tertua lebih dulu", () => {
    const result = allocateCredits(
      [credit("baru", "2026-09-20", 500_000), credit("lama", "2026-08-01", 300_000)],
      400_000,
      TODAY
    );
    expect(result.allocations).toEqual([
      { credit_id: "lama", credit_number: "VC-lama", amount: 300_000 },
      { credit_id: "baru", credit_number: "VC-baru", amount: 100_000 },
    ]);
    expect(result.remaining).toBe(0);
  });

  it("melewati kredit kedaluwarsa, tapi kredit yang habis hari ini masih dipakai", () => {
    const result = allocateCredits(
      [
        credit("hangus", "2026-07-01", 1_000_000, { expiry_date: "2026-10-02" }),
        credit("hari-ini", "2026-08-01", 200_000, { expiry_date: TODAY }),
      ],
      500_000,
      TODAY
    );
    expect(result.allocations.map((a) => a.credit_id)).toEqual(["hari-ini"]);
    expect(result.remaining).toBe(300_000);
  });

  it("hanya memakai sisa kredit yang sudah sebagian terpakai", () => {
    const result = allocateCredits([credit("a", "2026-08-01", 100_000, { applied_amount: 70_000 })], 50_000, TODAY);
    expect(result.allocations[0].amount).toBe(30_000);
    expect(result.remaining).toBe(20_000);
  });

  it("mengabaikan kredit yang belum disetujui atau dibatalkan", () => {
    const result = allocateCredits(
      [credit("draft", "2026-08-01", 100_000, { status: "draft" }), credit("batal", "2026-08-02", 100_000, { status: "cancelled" })],
      50_000,
      TODAY
    );
    expect(result.allocations).toEqual([]);
    expect(result.remaining).toBe(50_000);
  });

  it("jumlah nol tidak mengalokasikan apa pun", () => {
    expect(allocateCredits([credit("a", "2026-08-01", 100)], 0, TODAY)).toEqual({ allocations: [], remaining: 0 });
  });

  it("membulatkan ke sen", () => {
    expect(creditRemaining(credit("a", "2026-08-01", 100.005, { applied_amount: 0.001 }))).toBe(100);
  });
});

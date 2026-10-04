import { describe, expect, it } from "vitest";
import type { BillingProfile } from "@/lib/pos/billing-settings";
import {
  chargesForSave,
  editorStateFromProfile,
  ensureCoreCharges,
  emptyCharge,
  matchBillingProfile,
  nextFeeCharge,
} from "./billing-charges";

const profile = (over: Partial<BillingProfile>): BillingProfile => ({
  id: "p",
  branch_id: null,
  warehouse_id: null,
  name: "P",
  is_active: true,
  scope: "system",
  charges: [],
  ...over,
});

describe("billing charges", () => {
  it("tax & service selalu ada", () => {
    const kinds = ensureCoreCharges([emptyCharge({ code: "FEE1" })]).map((c) => c.charge_kind);
    expect(kinds).toEqual(["fee", "tax", "service"]);
  });

  it("profil berlaku: stall → cabang → sistem", () => {
    const profiles = [
      profile({ id: "sys" }),
      profile({ id: "br", branch_id: "b1" }),
      profile({ id: "st", branch_id: "b1", warehouse_id: "w1" }),
    ];
    expect(matchBillingProfile(profiles, "b1", "w1")?.id).toBe("st");
    expect(matchBillingProfile(profiles, "b1", "w2")?.id).toBe("br");
    expect(matchBillingProfile(profiles, "b2", "")?.id).toBe("sys");
    expect(matchBillingProfile([], "", "")).toBeNull();
  });

  it("state editor: tanpa profil pakai nama default scope", () => {
    expect(editorStateFromProfile(null, { branchId: "b1", warehouseId: "w1" }).profileName).toBe("Billing Stall");
    expect(editorStateFromProfile(profile({ id: "x", name: "Mall" }), { branchId: "", warehouseId: "" })).toMatchObject({
      profileId: "x",
      profileName: "Mall",
    });
  });

  it("simpan: kode wajib & unik, huruf besar, tax/service jadi persen", () => {
    const base = ensureCoreCharges([]).map((c) => ({ ...c, calc_method: "fixed" as const }));
    const fee = nextFeeCharge(base);
    expect(fee.code).toBe("FEE1");
    const ok = chargesForSave([...base, { ...fee, code: " fee1 " }]);
    expect(ok.ok && ok.charges.map((c) => [c.code, c.calc_method])).toEqual([
      ["TAX", "percent"],
      ["SERVICE", "percent"],
      ["FEE1", "fixed"],
    ]);
    expect(chargesForSave([...base, { ...fee, code: "" }])).toEqual({ ok: false, error: "Setiap biaya wajib punya uniqcode" });
    expect(chargesForSave([...base, fee, { ...fee }])).toEqual({ ok: false, error: "Kode biaya harus unik" });
  });
});

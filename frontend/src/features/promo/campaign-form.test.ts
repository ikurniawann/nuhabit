import { describe, expect, it } from "vitest";
import {
  EMPTY_CAMPAIGN_FORM,
  campaignFormFromCampaign,
  campaignPayload,
  codesCsv,
  formatCampaignDiscount,
  formatCampaignWindow,
  isCampaignFormInvalid,
  isValidNewMemberDays,
  resolveVoucherPrefix,
} from "./campaign-form";
import type { PromoCampaign } from "./types";

const valid = { ...EMPTY_CAMPAIGN_FORM, name: "Promo", value: "10" };

describe("campaign form", () => {
  it("validasi buat: nama, nilai, persen ≤ 100, tanggal, batch 1–1000, kode publik", () => {
    expect(isCampaignFormInvalid(valid, false)).toBe(false);
    expect(isCampaignFormInvalid({ ...valid, name: "P" }, false)).toBe(true);
    expect(isCampaignFormInvalid({ ...valid, value: "101" }, false)).toBe(true);
    expect(isCampaignFormInvalid({ ...valid, discount_type: "fixed", value: "101" }, false)).toBe(false);
    expect(isCampaignFormInvalid({ ...valid, valid_from: "2026-10-02", valid_until: "2026-10-01" }, false)).toBe(true);
    expect(isCampaignFormInvalid({ ...valid, batch_count: "0" }, false)).toBe(true);
    expect(isCampaignFormInvalid({ ...valid, code_mode: "public", public_code: "AB" }, false)).toBe(true);
    expect(isCampaignFormInvalid({ ...valid, code_mode: "public", public_code: "MERDEKA45" }, false)).toBe(false);
  });

  it("validasi ubah: jumlah voucher 0–1000 wajib diisi", () => {
    expect(isCampaignFormInvalid({ ...valid, batch_count: "0" }, true)).toBe(false);
    expect(isCampaignFormInvalid({ ...valid, batch_count: "" }, true)).toBe(true);
  });

  it("hari member baru: kosong boleh, selain itu 1–3650", () => {
    expect(isValidNewMemberDays({ eligibility: "member_baru", new_member_days: "" })).toBe(true);
    expect(isValidNewMemberDays({ eligibility: "member_baru", new_member_days: "0" })).toBe(false);
    expect(isValidNewMemberDays({ eligibility: "semua", new_member_days: "0" })).toBe(true);
  });

  it("payload: max_discount hanya persen, kosong → null", () => {
    expect(campaignPayload({ ...valid, max_discount: "5000", usage_limit: "", per_phone_limit: "" })).toMatchObject({
      value: 10, max_discount: 5000, min_purchase: 0, usage_limit: null, per_phone_limit: null, new_member_days: null,
    });
    expect(campaignPayload({ ...valid, discount_type: "fixed", max_discount: "5000" }).max_discount).toBeNull();
  });

  it("prefix voucher: isian admin atau bawaan kanal", () => {
    expect(resolveVoucherPrefix({ batch_prefix: " vip ", scope: "pos" })).toBe("VIP");
    expect(resolveVoucherPrefix({ batch_prefix: "", scope: "pos" })).toBe("POS");
  });

  it("form ubah dari campaign tersimpan", () => {
    const campaign = {
      name: "Promo", discount_type: "percent", value: "10.00", max_discount: null, min_purchase: "0",
      valid_from: null, valid_until: null, usage_limit: null, per_phone_limit: 1, scope: "pos",
      target_product_ids: [], target_category_ids: [], eligibility: "semua", new_member_days: null, codes_count: "12",
    } as unknown as PromoCampaign;
    expect(campaignFormFromCampaign(campaign)).toMatchObject({ value: "10", min_purchase: "", batch_count: "12", code_mode: "none" });
  });

  it("teks tabel & CSV", () => {
    expect(formatCampaignDiscount({ discount_type: "percent", value: "10", max_discount: "25000" })).toBe("10% (maks Rp25.000)");
    expect(formatCampaignDiscount({ discount_type: "fixed", value: "15000", max_discount: null })).toBe("Rp15.000");
    expect(formatCampaignWindow({ valid_from: null, valid_until: null })).toBe("Tanpa batas waktu");
    expect(codesCsv([{ code: "POS-A", usage_limit: 1, usage_count: 0, is_active: true }]))
      .toBe("code,usage_limit,usage_count,is_active\nPOS-A,1,0,1");
  });
});

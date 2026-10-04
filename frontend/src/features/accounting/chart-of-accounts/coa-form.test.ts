import { describe, expect, it } from "vitest";
import {
  EMPTY_COA_FORM,
  coaPayload,
  formForNewChild,
  isCoaFormComplete,
  parentCandidates,
  resolveFormCompanyId,
} from "./coa-form";
import type { CoaAccountItem } from "./types";

function acc(id: string, parent: string | null, level: number, company: string | null = "c1"): CoaAccountItem {
  return {
    id,
    company_id: company,
    code: id,
    code_display: id,
    name: id,
    parent_id: parent,
    account_type_id: `type-${id}`,
    account_type_code: "ASSET",
    account_type_name: "Asset",
    normal_balance: "DEBIT",
    level,
    is_postable: level === 4,
    is_contra: false,
    is_cash_bank: false,
    cash_flow_category: null,
    description: null,
    is_active: true,
    created_at: "",
  };
}

const rows = [acc("1", null, 1), acc("11", "1", 2), acc("111", "11", 3), acc("1111", "111", 4), acc("2", null, 1, "c2")];

describe("parentCandidates", () => {
  it("buang akun sendiri + turunan, leaf level 4, dan company lain", () => {
    expect(parentCandidates(rows, "11", "c1").map((r) => r.id)).toEqual(["1"]);
    expect(parentCandidates(rows, null, "c1").map((r) => r.id)).toEqual(["1", "11", "111"]);
  });
});

describe("resolveFormCompanyId", () => {
  it("prioritas: akun diedit, parent, lalu COA yang tampil", () => {
    expect(resolveFormCompanyId(rows[4], "1", rows)).toBe("c2");
    expect(resolveFormCompanyId(null, "2", rows)).toBe("c2");
    expect(resolveFormCompanyId(null, "", rows)).toBe("c1");
  });
});

describe("form helpers", () => {
  it("child mewarisi type parent; payload kosong jadi null", () => {
    const form = formForNewChild(rows[1], "default-type");
    expect(form).toMatchObject({ parent_id: "11", account_type_id: "type-11" });
    expect(formForNewChild(null, "default-type").account_type_id).toBe("default-type");
    expect(coaPayload({ ...EMPTY_COA_FORM, code: "1", name: "Kas", account_type_id: "t" })).toMatchObject({
      parent_id: null,
      cash_flow_category: null,
      description: null,
    });
  });

  it("wajib kode, nama, dan type", () => {
    expect(isCoaFormComplete({ ...EMPTY_COA_FORM, code: " ", name: "Kas", account_type_id: "t" })).toBe(false);
    expect(isCoaFormComplete({ ...EMPTY_COA_FORM, code: "1", name: "Kas", account_type_id: "t" })).toBe(true);
  });
});

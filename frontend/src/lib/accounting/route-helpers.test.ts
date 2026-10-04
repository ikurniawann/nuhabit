import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/auth";
import type { UserScope } from "@/lib/api/scope";
import { assertRecordInScope, parseInvoiceListQuery, rethrowUniqueViolation } from "./route-helpers";

const companyScope: UserScope = {
  userId: "u",
  role: "admin",
  businessScope: "company",
  holdingId: null,
  companyId: "c-1",
  branchId: null,
  isUnscoped: false,
};
const messages = { notFound: "Tidak ada", outOfScope: "Di luar scope", global: "Global terkunci" };

function caught(fn: () => unknown): ApiError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ApiError) return error;
  }
  throw new Error("expected ApiError");
}

describe("assertRecordInScope", () => {
  it("404 bila record tidak ada", () => {
    expect(caught(() => assertRecordInScope(null, companyScope, messages)).status).toBe(404);
  });

  it("403 bila company lain", () => {
    const err = caught(() => assertRecordInScope({ company_id: "c-2" }, companyScope, messages));
    expect([err.status, err.message]).toEqual([403, "Di luar scope"]);
  });

  it("record global hanya terkunci untuk mutasi user ber-scope", () => {
    const record = { company_id: null };
    expect(assertRecordInScope(record, companyScope, { ...messages, global: undefined })).toBe(record);
    expect(caught(() => assertRecordInScope(record, companyScope, messages)).message).toBe("Global terkunci");
    expect(assertRecordInScope(record, { ...companyScope, isUnscoped: true }, messages)).toBe(record);
  });

  it("record company sendiri lolos", () => {
    const record = { company_id: "c-1" };
    expect(assertRecordInScope(record, companyScope, messages)).toBe(record);
  });
});

describe("rethrowUniqueViolation", () => {
  it("23505 jadi 400 berpesan domain, galat lain diteruskan", () => {
    const rethrow = rethrowUniqueViolation("Kode sudah dipakai");
    const err = caught(() => rethrow({ code: "23505" }));
    expect([err.status, err.message]).toEqual([400, "Kode sudah dipakai"]);
    const other = new Error("x");
    expect(() => rethrow(other)).toThrow(other);
  });
});

describe("parseInvoiceListQuery", () => {
  it("default limit 20 offset 0, string kosong jadi undefined", () => {
    expect(parseInvoiceListQuery(new URLSearchParams("status=&payment_status=PAID"))).toEqual({
      status: undefined,
      paymentStatus: "PAID",
      search: undefined,
      limit: 20,
      offset: 0,
    });
  });
});

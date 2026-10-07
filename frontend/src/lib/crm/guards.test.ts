import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError, type ApiUser } from "@/lib/api/auth";

const auth = vi.hoisted(() => ({ requireIamMenuPrefix: vi.fn() }));
vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/auth")>()),
  requireIamMenuPrefix: auth.requireIamMenuPrefix,
}));
vi.mock("@/lib/api/scope", () => ({ getApiUserScope: vi.fn(async () => ({ companyId: "co-1" })) }));

import { crmSchemaError, parseCrmInput, requireCrmScope, requireCrmUser, scopedCompanyId } from "./guards";

const user: ApiUser = { id: "u1", full_name: "Admin", role: "admin", brand_id: null };

beforeEach(() => {
  vi.clearAllMocks();
  auth.requireIamMenuPrefix.mockResolvedValue(user);
});

describe("requireCrmUser", () => {
  it("memetakan gate ke prefix menu IAM", async () => {
    await requireCrmUser("settings");
    expect(auth.requireIamMenuPrefix).toHaveBeenLastCalledWith(["crm.settings"]);
    await requireCrmUser("segments");
    expect(auth.requireIamMenuPrefix).toHaveBeenLastCalledWith(["crm.promo", "promo", "crm"]);
    await requireCrmUser("operator");
    expect(auth.requireIamMenuPrefix).toHaveBeenLastCalledWith([
      "crm.loyalty",
      "crm.members",
      "pos.operations",
      "pos.cashier.central",
    ]);
  });

  it("galat gate diteruskan", async () => {
    auth.requireIamMenuPrefix.mockRejectedValue(ApiError.forbidden());
    await expect(requireCrmUser("inbox")).rejects.toMatchObject({ status: 403 });
  });

  it("requireCrmScope menambahkan scope user", async () => {
    await expect(requireCrmScope("reports")).resolves.toEqual({ user, scope: { companyId: "co-1" } });
  });
});

describe("scopedCompanyId", () => {
  it("super_admin tanpa scope → global (null); selain itu company scope", () => {
    expect(scopedCompanyId({ ...user, role: "super_admin" }, null)).toBeNull();
    expect(scopedCompanyId(user, { companyId: "co-1" } as never)).toBe("co-1");
    expect(scopedCompanyId(user, null)).toBeNull();
  });
});

describe("parseCrmInput", () => {
  const schema = z
    .object({ a: z.number(), b: z.number() })
    .refine((v) => v.b > v.a, { message: "B harus lebih besar" });

  it("pesan refine buatan kita, selain itu 'Data tidak valid'", () => {
    expect(() => parseCrmInput(schema, { a: 2, b: 1 })).toThrow("B harus lebih besar");
    expect(() => parseCrmInput(schema, { a: "x" })).toThrow("Data tidak valid");
    expect(parseCrmInput(schema, { a: 1, b: 2 })).toEqual({ a: 1, b: 2 });
  });
});

describe("crmSchemaError", () => {
  it("tabel CRM hilang → 409; galat lain diteruskan", () => {
    expect(crmSchemaError({ code: "42P01" })).toMatchObject({ status: 409, message: "CRM migration belum diterapkan" });
    const other = { code: "23505" };
    expect(crmSchemaError(other)).toBe(other);
  });
});

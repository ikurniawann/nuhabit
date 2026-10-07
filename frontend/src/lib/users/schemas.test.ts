import { describe, it, expect } from "vitest";
import { createUserEmployeeSchema, updateUserEmployeeSchema } from "./schemas";

const baseEmployee = {
  full_name: "Budi Santoso",
  email: "budi@arkivworld.com",
  join_date: "2024-06-01",
  employment_status: "permanent",
};

describe("createUserEmployeeSchema", () => {
  it("accepts employee without app access", () => {
    const result = createUserEmployeeSchema.safeParse({
      ...baseEmployee,
      is_access_app: false,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.is_access_app).toBe(false);
      expect(result.data.approval_permissions).toEqual([]);
    }
  });

  it("defaults is_access_app to false", () => {
    const result = createUserEmployeeSchema.parse(baseEmployee);
    expect(result.is_access_app).toBe(false);
  });

  it("requires password and role when is_access_app is true", () => {
    const result = createUserEmployeeSchema.safeParse({
      ...baseEmployee,
      is_access_app: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join("."));
      expect(paths).toContain("password");
      expect(paths).toContain("role");
    }
  });

  it("accepts employee with full app access", () => {
    const result = createUserEmployeeSchema.safeParse({
      ...baseEmployee,
      is_access_app: true,
      password: "SecurePass1",
      role: "hrd",
      business_scope: "holding",
      holding_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      account_status: "active",
      approval_permissions: [
        {
          module: "hris",
          workflow: "leave_request",
          approval_level: "approver",
          approval_limit: null,
          is_active: true,
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("rejects invalid email", () => {
    const result = createUserEmployeeSchema.safeParse({
      ...baseEmployee,
      email: "not-email",
    });
    expect(result.success).toBe(false);
  });

  it("rejects short full_name", () => {
    const result = createUserEmployeeSchema.safeParse({
      ...baseEmployee,
      full_name: "A",
    });
    expect(result.success).toBe(false);
  });

  it("rejects password shorter than 8 when app access enabled", () => {
    const result = createUserEmployeeSchema.safeParse({
      ...baseEmployee,
      is_access_app: true,
      password: "short",
      role: "admin",
    });
    expect(result.success).toBe(false);
  });

  it("requires default stall for branch scope", () => {
    const result = createUserEmployeeSchema.safeParse({
      ...baseEmployee,
      is_access_app: true,
      password: "SecurePass1",
      role: "pos",
      business_scope: "branch",
      holding_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      company_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567891",
      branch_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567892",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes("default_warehouse_id"))).toBe(
        true
      );
    }
  });

  it("accepts branch scope with default stall", () => {
    const result = createUserEmployeeSchema.safeParse({
      ...baseEmployee,
      is_access_app: true,
      password: "SecurePass1",
      role: "pos",
      business_scope: "branch",
      holding_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      company_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567891",
      branch_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567892",
      default_warehouse_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567893",
      can_switch_stall: true,
      can_central_checkout: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.can_central_checkout).toBe(true);
    }
  });

  it("rejects mismatched approval workflow for module", () => {
    const result = createUserEmployeeSchema.safeParse({
      ...baseEmployee,
      is_access_app: true,
      password: "SecurePass1",
      role: "admin",
      approval_permissions: [
        {
          module: "hris",
          workflow: "purchase_request",
          approval_level: "approver",
          is_active: true,
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe("updateUserEmployeeSchema", () => {
  it("allows partial employee updates", () => {
    const result = updateUserEmployeeSchema.safeParse({
      phone: "08123456789",
    });
    expect(result.success).toBe(true);
  });

  it("allows toggling is_access_app only", () => {
    const result = updateUserEmployeeSchema.safeParse({
      is_access_app: true,
    });
    expect(result.success).toBe(true);
  });

  it("rejects short password when provided with app access", () => {
    const result = updateUserEmployeeSchema.safeParse({
      is_access_app: true,
      password: "123",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes("password"))).toBe(
        true
      );
    }
  });

  it("accepts valid password update", () => {
    const result = updateUserEmployeeSchema.safeParse({
      password: "NewPass123",
      role: "purchasing_staff",
    });
    expect(result.success).toBe(true);
  });
});

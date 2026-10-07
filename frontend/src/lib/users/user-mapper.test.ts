import { describe, it, expect } from "vitest";
import { mapEmployeeUserRow, type EmployeeUserRow } from "./user-mapper";

function buildRow(overrides: Partial<EmployeeUserRow> = {}): EmployeeUserRow {
  return {
    id: "emp-1",
    user_id: null,
    full_name: "Budi Santoso",
    nip: "EMP-2024-00001",
    email: "budi@arkivworld.com",
    phone: "08123456789",
    join_date: "2024-01-15",
    end_date: null,
    employment_status: "permanent",
    is_active: true,
    is_access_app: false,
    department_id: "dept-1",
    section_id: null,
    job_title_id: "job-1",
    reporting_to: null,
    ktp: null,
    npwp: null,
    birth_date: null,
    gender: null,
    marital_status: null,
    address: null,
    city: null,
    province: null,
    postal_code: null,
    bank_name: null,
    bank_account: null,
    bpjs_tk: null,
    bpjs_kesehatan: null,
    emergency_contact_name: null,
    emergency_contact_phone: null,
    emergency_contact_relationship: null,
    photo_url: null,
    notes: null,
    created_at: "2024-01-15T00:00:00Z",
    updated_at: null,
    department: { id: "dept-1", name: "HR" },
    section: null,
    job_title: { id: "job-1", title: "Staff HR" },
    manager: null,
    app_user: null,
    ...overrides,
  };
}

describe("mapEmployeeUserRow", () => {
  it("maps snake_case DB row to camelCase API model", () => {
    const mapped = mapEmployeeUserRow(buildRow());

    expect(mapped.id).toBe("emp-1");
    expect(mapped.fullName).toBe("Budi Santoso");
    expect(mapped.isAccessApp).toBe(false);
    expect(mapped.department?.name).toBe("HR");
    expect(mapped.jobTitle?.title).toBe("Staff HR");
    expect(mapped.appAccount).toBeNull();
  });

  it("maps linked app account when present", () => {
    const mapped = mapEmployeeUserRow(
      buildRow({
        user_id: "user-1",
        is_access_app: true,
        app_user: {
          id: "user-1",
          role: "hrd",
          status: "active",
          brand_id: null,
          business_scope: "company" as const,
          holding_id: "holding-1",
          company_id: "company-1",
          branch_id: null,
          holding: { id: "holding-1", name: "Prologe" },
          company: { id: "company-1", name: "Sulu" },
          branch: null,
          brands: null,
          last_sign_in_at: "2024-06-01T10:00:00Z",
          user_approval_permissions: [
            {
              id: "perm-1",
              module: "hris",
              workflow: "leave_request",
              approval_level: "approver",
              approval_limit: 5000000,
              is_active: true,
            },
          ],
        },
      })
    );

    expect(mapped.userId).toBe("user-1");
    expect(mapped.isAccessApp).toBe(true);
    expect(mapped.appAccount).toMatchObject({
      id: "user-1",
      role: "hrd",
      status: "active",
      businessScope: "company",
      holdingId: "holding-1",
      companyId: "company-1",
      holdingName: "Prologe",
      companyName: "Sulu",
      lastSignInAt: "2024-06-01T10:00:00Z",
    });
    expect(mapped.appAccount?.approvalPermissions).toHaveLength(1);
  });
});

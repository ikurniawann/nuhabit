import { describe, it, expect } from "vitest";
import {
  EMPLOYEES_ROUTES,
  emptyUserForm,
  formatCurrency,
  levelLabel,
  moduleLabel,
  workflowLabel,
  workflowsForModule,
} from "./index";

describe("users constants helpers", () => {
  it("EMPLOYEES_ROUTES follow insert/edit convention", () => {
    expect(EMPLOYEES_ROUTES.insert).toBe("/dashboard/employees/insert");
    expect(EMPLOYEES_ROUTES.edit("x")).toBe("/dashboard/employees/edit/x");
  });

  it("emptyUserForm has safe defaults", () => {
    expect(emptyUserForm.is_access_app).toBe(false);
    expect(emptyUserForm.account_status).toBe("active");
    expect(emptyUserForm.approval_permissions).toEqual([]);
    expect(emptyUserForm.role).toBe("admin");
    expect(emptyUserForm.can_switch_stall).toBe(false);
    expect(emptyUserForm.can_central_checkout).toBe(false);
    expect(emptyUserForm.default_warehouse_id).toBe("");
  });

  it("workflowsForModule returns only matching workflows", () => {
    const hrisWorkflows = workflowsForModule("hris");
    expect(hrisWorkflows.every((w) => w.module === "hris")).toBe(true);
    expect(hrisWorkflows.some((w) => w.value === "leave_request")).toBe(true);
  });

  it("labels resolve known values", () => {
    expect(moduleLabel("purchasing")).toBe("Purchasing");
    expect(workflowLabel("purchase_request")).toBe("Purchase Request");
    expect(levelLabel("approver")).toBe("Approver");
  });

  it("formatCurrency formats IDR and handles null", () => {
    expect(formatCurrency(null)).toBe("Tanpa limit");
    expect(formatCurrency(1500000)).toContain("1.500.000");
  });
});

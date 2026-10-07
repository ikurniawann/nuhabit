import { z } from "zod";
import type { UserRole } from "@/types";

export const ADMIN_USER_ROLES = [
  "super_admin",
  "admin",
  "hrd",
  "hiring_manager",
  "direksi",
  "purchasing_admin",
  "purchasing_manager",
  "purchasing_staff",
  "finance_staff",
  "warehouse_staff",
  "warehouse_admin",
  "pos",
  "pos_supervisor",
  "qc_staff",
  "employee",
  "sales",
  "marketing",
] as const satisfies readonly UserRole[];

export const APPROVAL_MODULES = [
  { value: "purchasing", label: "Purchasing" },
  { value: "inventory", label: "Inventory" },
  { value: "pos", label: "POS" },
  { value: "finance", label: "Finance" },
  { value: "hris", label: "HRIS" },
] as const;

export const APPROVAL_WORKFLOWS = [
  { value: "purchase_request", label: "Purchase Request", module: "purchasing" },
  { value: "purchase_order", label: "Purchase Order", module: "purchasing" },
  { value: "goods_receipt", label: "Goods Receipt", module: "purchasing" },
  { value: "inventory_adjustment", label: "Inventory Adjustment", module: "inventory" },
  { value: "pos_void", label: "POS Void", module: "pos" },
  { value: "pos_refund", label: "POS Refund", module: "pos" },
  { value: "vendor_payment", label: "Vendor Payment", module: "finance" },
  { value: "leave_request", label: "Leave Request", module: "hris" },
] as const;

export const APPROVAL_LEVELS = [
  { value: "checker", label: "Checker" },
  { value: "approver", label: "Approver" },
  { value: "final_approver", label: "Final Approver" },
] as const;

export const approvalPermissionSchema = z.object({
  id: z.string().uuid().optional(),
  module: z.enum(["purchasing", "inventory", "pos", "finance", "hris"]),
  workflow: z.enum([
    "purchase_request",
    "purchase_order",
    "goods_receipt",
    "inventory_adjustment",
    "pos_void",
    "pos_refund",
    "vendor_payment",
    "leave_request",
  ]),
  approval_level: z.enum(["checker", "approver", "final_approver"]),
  approval_limit: z.coerce.number().nonnegative().nullable().optional(),
  is_active: z.boolean().default(true),
}).superRefine((permission, context) => {
  const workflow = APPROVAL_WORKFLOWS.find((item) => item.value === permission.workflow);
  if (!workflow || workflow.module !== permission.module) {
    context.addIssue({
      code: "custom",
      path: ["workflow"],
      message: "Workflow tidak sesuai dengan module approval",
    });
  }
});

export const createAdminUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  full_name: z.string().min(2),
  role: z.enum(ADMIN_USER_ROLES),
  brand_id: z.string().uuid().nullable().optional(),
  status: z.enum(["active", "inactive"]).default("active"),
  approval_permissions: z.array(approvalPermissionSchema).default([]),
});

export const updateAdminUserSchema = z.object({
  email: z.string().email().optional(),
  full_name: z.string().min(2).optional(),
  role: z.enum(ADMIN_USER_ROLES).optional(),
  brand_id: z.string().uuid().nullable().optional(),
  status: z.enum(["active", "inactive"]).optional(),
  approval_permissions: z.array(approvalPermissionSchema).optional(),
});

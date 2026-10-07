import { z } from "zod";
import {
  ADMIN_USER_ROLES,
  approvalPermissionSchema,
} from "@/lib/admin/user-management";
import {
  normalizeBusinessScopePayload,
  validateBusinessScope,
} from "@/lib/configuration/business-scope";
import { requiresStallAssignment, resolveDefaultWarehouseId } from "./stall-assignment";

const employeeCoreSchema = z.object({
  full_name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().optional().nullable(),
  join_date: z.string().min(1),
  employment_status: z.string().min(1),
  ktp: z.string().optional().nullable(),
  npwp: z.string().optional().nullable(),
  birth_date: z.string().optional().nullable(),
  gender: z.string().optional().nullable(),
  marital_status: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  province: z.string().optional().nullable(),
  postal_code: z.string().optional().nullable(),
  department_id: z.string().uuid().optional().nullable(),
  section_id: z.string().uuid().optional().nullable(),
  job_title_id: z.string().uuid().optional().nullable(),
  reporting_to: z.string().uuid().optional().nullable(),
  bank_name: z.string().optional().nullable(),
  bank_account: z.string().optional().nullable(),
  bpjs_tk: z.string().optional().nullable(),
  bpjs_kesehatan: z.string().optional().nullable(),
  emergency_contact_name: z.string().optional().nullable(),
  emergency_contact_phone: z.string().optional().nullable(),
  emergency_contact_relationship: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  nip: z.string().optional().nullable(),
  is_active: z.boolean().optional(),
  end_date: z.string().optional().nullable(),
});

const businessScopeFieldsSchema = z.object({
  business_scope: z.enum(["holding", "company", "branch"]).optional().nullable(),
  holding_id: z.string().uuid().nullable().optional(),
  company_id: z.string().uuid().nullable().optional(),
  branch_id: z.string().uuid().nullable().optional(),
  warehouse_ids: z.array(z.string().uuid()).optional(),
  default_warehouse_id: z.string().uuid().nullable().optional(),
  can_switch_stall: z.boolean().optional(),
  can_central_checkout: z.boolean().optional(),
});

const appAccessSchema = z
  .object({
    is_access_app: z.boolean().default(false),
    password: z.string().min(8).optional(),
    role: z.enum(ADMIN_USER_ROLES).optional(),
    brand_id: z.string().uuid().nullable().optional(),
    account_status: z.enum(["active", "inactive"]).optional(),
    approval_permissions: z.array(approvalPermissionSchema).default([]),
  })
  .merge(businessScopeFieldsSchema);

export const createUserEmployeeSchema = employeeCoreSchema
  .merge(appAccessSchema)
  .superRefine((data, ctx) => {
    if (!data.is_access_app) return;
    if (!data.password) {
      ctx.addIssue({
        code: "custom",
        path: ["password"],
        message: "Password is required for app access",
      });
    }
    if (!data.role) {
      ctx.addIssue({
        code: "custom",
        path: ["role"],
        message: "Role is required for app access",
      });
    }

    const scopeError = validateBusinessScope(
      data.role,
      true,
      normalizeBusinessScopePayload(
        data.business_scope ?? null,
        data.holding_id,
        data.company_id,
        data.branch_id
      )
    );
    if (scopeError) {
      ctx.addIssue({
        code: "custom",
        path: ["business_scope"],
        message: scopeError,
      });
    }

    const scopePayload = normalizeBusinessScopePayload(
      data.business_scope ?? null,
      data.holding_id,
      data.company_id,
      data.branch_id
    );
    if (
      requiresStallAssignment(data.role, scopePayload.business_scope ?? null, true) &&
      !resolveDefaultWarehouseId({
        defaultWarehouseId: data.default_warehouse_id,
        warehouseIds: data.warehouse_ids,
      })
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["default_warehouse_id"],
        message: "Stall default wajib untuk scope branch",
      });
    }
  });

export const updateUserEmployeeSchema = employeeCoreSchema
  .partial()
  .merge(
    z.object({
      is_access_app: z.boolean().optional(),
      password: z.string().min(8).optional(),
      role: z.enum(ADMIN_USER_ROLES).optional(),
      brand_id: z.string().uuid().nullable().optional(),
      account_status: z.enum(["active", "inactive"]).optional(),
      approval_permissions: z.array(approvalPermissionSchema).optional(),
    })
      .merge(businessScopeFieldsSchema)
  )
  .superRefine((data, ctx) => {
    if (data.is_access_app === true && data.password !== undefined && data.password.length < 8) {
      ctx.addIssue({
        code: "custom",
        path: ["password"],
        message: "Password must be at least 8 characters",
      });
    }

    if (data.is_access_app !== true) return;

    const scopeError = validateBusinessScope(
      data.role,
      true,
      normalizeBusinessScopePayload(
        data.business_scope ?? null,
        data.holding_id,
        data.company_id,
        data.branch_id
      )
    );
    if (scopeError) {
      ctx.addIssue({
        code: "custom",
        path: ["business_scope"],
        message: scopeError,
      });
    }

    const scopePayload = normalizeBusinessScopePayload(
      data.business_scope ?? null,
      data.holding_id,
      data.company_id,
      data.branch_id
    );
    if (
      requiresStallAssignment(
        data.role,
        scopePayload.business_scope ?? null,
        data.is_access_app === true
      ) &&
      !resolveDefaultWarehouseId({
        defaultWarehouseId: data.default_warehouse_id,
        warehouseIds: data.warehouse_ids,
      })
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["default_warehouse_id"],
        message: "Stall default wajib untuk scope branch",
      });
    }
  });

export type CreateUserEmployeeInput = z.infer<typeof createUserEmployeeSchema>;
export type UpdateUserEmployeeInput = z.infer<typeof updateUserEmployeeSchema>;

import {
  ADMIN_USER_ROLES,
  APPROVAL_LEVELS,
  APPROVAL_MODULES,
  APPROVAL_WORKFLOWS,
} from "@/lib/admin/user-management";
import { crudDetailPath, crudEditPath, crudInsertPath } from "@/lib/routes/crud-routes";
import type { UserRole } from "@/types";
import type { ApprovalPermission, UserEmployeeFormValues } from "../types";

export const EMPLOYEES_BASE_PATH = "/dashboard/employees";

export const EMPLOYEES_ROUTES = {
  list: EMPLOYEES_BASE_PATH,
  insert: crudInsertPath(EMPLOYEES_BASE_PATH),
  detail: (id: string) => crudDetailPath(EMPLOYEES_BASE_PATH, id),
  edit: (id: string) => crudEditPath(EMPLOYEES_BASE_PATH, id),
} as const;

export { ADMIN_USER_ROLES, APPROVAL_LEVELS, APPROVAL_MODULES, APPROVAL_WORKFLOWS };

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  hrd: "HRD",
  hiring_manager: "Hiring Manager",
  direksi: "Executive",
  purchasing_admin: "Purchasing Admin",
  purchasing_manager: "Purchasing Manager",
  purchasing_staff: "Purchasing Staff",
  finance_staff: "Finance Staff",
  warehouse_staff: "Warehouse Staff",
  warehouse_admin: "Warehouse Admin",
  pos: "POS",
  pos_supervisor: "POS Supervisor",
  qc_staff: "QC Staff",
  employee: "Karyawan (ESS)",
  sales: "Sales",
  marketing: "Marketing",
  program_director: "Program Director",
};

export const STATUS_LABELS: Record<string, string> = {
  probation: "Probation",
  contract: "Contract",
  permanent: "Permanent",
  internship: "Internship",
  resigned: "Resigned",
  terminated: "Terminated",
  suspended: "Suspended",
};

export const STATUS_COLORS: Record<string, string> = {
  probation: "bg-yellow-100 text-yellow-700",
  contract: "bg-blue-100 text-blue-700",
  permanent: "bg-green-100 text-green-700",
  internship: "bg-purple-100 text-purple-700",
  resigned: "bg-red-100 text-red-600",
  terminated: "bg-red-200 text-red-700",
  suspended: "bg-orange-100 text-orange-700",
};

export const GENDER_OPTIONS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
];

export const MARITAL_OPTIONS = [
  { value: "single", label: "Single" },
  { value: "married", label: "Married" },
  { value: "divorced", label: "Divorced" },
  { value: "widowed", label: "Widowed" },
];

export const emptyApprovalPermission: ApprovalPermission = {
  module: "purchasing",
  workflow: "purchase_request",
  approval_level: "approver",
  approval_limit: null,
  is_active: true,
};

export const emptyUserForm: UserEmployeeFormValues = {
  full_name: "",
  email: "",
  phone: "",
  join_date: "",
  employment_status: "",
  ktp: "",
  npwp: "",
  birth_date: "",
  gender: "",
  marital_status: "",
  address: "",
  city: "",
  province: "",
  postal_code: "",
  department_id: "",
  section_id: "",
  job_title_id: "",
  reporting_to: "",
  bank_name: "",
  bank_account: "",
  bpjs_tk: "",
  bpjs_kesehatan: "",
  emergency_contact_name: "",
  emergency_contact_phone: "",
  emergency_contact_relationship: "",
  notes: "",
  nip: "",
  is_active: true,
  end_date: "",
  is_access_app: false,
  password: "",
  role: "admin",
  business_scope: "",
  holding_id: "",
  company_id: "",
  branch_id: "",
  warehouse_ids: [],
  default_warehouse_id: "",
  can_switch_stall: false,
  can_central_checkout: false,
  account_status: "active",
  approval_permissions: [],
};

export function workflowsForModule(module: string) {
  return APPROVAL_WORKFLOWS.filter((workflow) => workflow.module === module);
}

export function workflowLabel(value: string) {
  return APPROVAL_WORKFLOWS.find((item) => item.value === value)?.label ?? value;
}

export function moduleLabel(value: string) {
  return APPROVAL_MODULES.find((item) => item.value === value)?.label ?? value;
}

export function levelLabel(value: string) {
  return APPROVAL_LEVELS.find((item) => item.value === value)?.label ?? value;
}

export function formatCurrency(value: number | null) {
  if (value == null) return "Tanpa limit";
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

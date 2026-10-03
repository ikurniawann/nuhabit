"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BanknotesIcon,
  BriefcaseIcon,
  PhoneIcon,
  UserCircleIcon,
} from "@heroicons/react/24/outline";
import { ArrowLeft, Loader2, ShieldCheck } from "lucide-react";
import { FormPageBody, FormPageFooter, FormPageLayout, FormPageLoading } from "@/components/layout/form-page-layout";
import {
  FormFieldLabel,
  formComboboxClassName,
  formInputClassName,
} from "@/components/layout/form-field";
import { FormSectionCard } from "@/components/layout/form-section-card";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { ToastContainer, useToast } from "@/components/ui/toast";
import { useAuth } from "@/hooks/use-auth";
import { useIamAccess } from "@/components/iam/iam-access-provider";
import { IAM } from "@/lib/iam/prefixes";
import { useBusinessTree } from "@/features/configuration/business";
import { normalizeBusinessScopePayload } from "@/lib/configuration/business-scope";
import { useCreateUser, useUpdateUser } from "../mutations";
import { useUserDetail, useUserFormLookups } from "../queries";
import type { UserEmployeeFormValues } from "../types";
import {
  EMPLOYEES_ROUTES,
  GENDER_OPTIONS,
  emptyUserForm,
  workflowsForModule,
} from "../constants";
import { AppAccessFormSection } from "./app-access-form-section";
import { ResetPasswordDialog } from "./reset-password-dialog";

function toFormValues(detail: NonNullable<ReturnType<typeof useUserDetail>["data"]>["data"]): UserEmployeeFormValues {
  return {
    full_name: detail.fullName,
    email: detail.email,
    phone: detail.phone ?? "",
    join_date: detail.joinDate?.slice(0, 10) ?? "",
    employment_status: detail.employmentStatus,
    ktp: detail.ktp ?? "",
    npwp: detail.npwp ?? "",
    birth_date: detail.birthDate?.slice(0, 10) ?? "",
    gender: detail.gender ?? "",
    marital_status: detail.maritalStatus ?? "",
    address: detail.address ?? "",
    city: detail.city ?? "",
    province: detail.province ?? "",
    postal_code: detail.postalCode ?? "",
    department_id: detail.departmentId ?? "",
    section_id: detail.sectionId ?? "",
    job_title_id: detail.jobTitleId ?? "",
    reporting_to: detail.reportingTo ?? "",
    bank_name: detail.bankName ?? "",
    bank_account: detail.bankAccount ?? "",
    bpjs_tk: detail.bpjsTk ?? "",
    bpjs_kesehatan: detail.bpjsKesehatan ?? "",
    emergency_contact_name: detail.emergencyContactName ?? "",
    emergency_contact_phone: detail.emergencyContactPhone ?? "",
    emergency_contact_relationship: detail.emergencyContactRelationship ?? "",
    notes: detail.notes ?? "",
    nip: detail.nip ?? "",
    is_active: detail.isActive,
    end_date: detail.endDate?.slice(0, 10) ?? "",
    is_access_app: detail.isAccessApp,
    password: "",
    role: detail.appAccount?.role ?? "admin",
    business_scope: detail.appAccount?.businessScope ?? "",
    holding_id: detail.appAccount?.holdingId ?? "",
    company_id: detail.appAccount?.companyId ?? "",
    branch_id: detail.appAccount?.branchId ?? "",
    warehouse_ids: detail.appAccount?.warehouses?.map((warehouse) => warehouse.id) ?? [],
    default_warehouse_id:
      detail.appAccount?.defaultWarehouseId ??
      detail.appAccount?.warehouses?.[0]?.id ??
      "",
    can_switch_stall: detail.appAccount?.canSwitchStall === true,
    can_central_checkout: detail.appAccount?.canCentralCheckout === true,
    account_status: detail.appAccount?.status ?? "active",
    approval_permissions:
      detail.appAccount?.approvalPermissions
        ?.filter((p) => p.is_active)
        .map((p) => ({
          id: p.id,
          module: p.module,
          workflow: p.workflow,
          approval_level: p.approval_level as UserEmployeeFormValues["approval_permissions"][number]["approval_level"],
          approval_limit: p.approval_limit,
          is_active: true,
        })) ?? [],
  };
}

function buildPayload(form: UserEmployeeFormValues, isEdit: boolean) {
  const base: Record<string, unknown> = {};
  const nullable = (v: string) => (v === "" ? null : v);

  for (const [key, value] of Object.entries(form)) {
    if (
      key === "password" ||
      key === "role" ||
      key === "business_scope" ||
      key === "holding_id" ||
      key === "company_id" ||
      key === "branch_id" ||
      key === "warehouse_ids" ||
      key === "default_warehouse_id" ||
      key === "can_switch_stall" ||
      key === "can_central_checkout" ||
      key === "account_status" ||
      key === "approval_permissions" ||
      key === "is_access_app"
    ) {
      continue;
    }
    if (typeof value === "boolean") base[key] = value;
    else if (typeof value === "string") base[key] = nullable(value);
  }

  base.is_access_app = form.is_access_app;

  if (form.is_access_app) {
    base.role = form.role;
    base.account_status = form.account_status;
    base.approval_permissions = form.approval_permissions;
    base.warehouse_ids = form.default_warehouse_id
      ? [form.default_warehouse_id]
      : form.warehouse_ids;
    base.default_warehouse_id = form.default_warehouse_id || null;
    base.can_switch_stall = form.can_switch_stall;
    base.can_central_checkout = form.can_central_checkout;

    const scope = normalizeBusinessScopePayload(
      form.role === "super_admin" ? null : form.business_scope || null,
      form.holding_id || null,
      form.company_id || null,
      form.branch_id || null
    );
    Object.assign(base, scope);

    if (form.password) base.password = form.password;
    else if (!isEdit) base.password = form.password;
  }

  return base;
}

interface UserFormPageProps {
  mode: "create" | "edit";
  employeeId?: string;
}

export function UserFormPage({ mode, employeeId }: UserFormPageProps) {
  const router = useRouter();
  const { user } = useAuth();
  const { toasts, showToast, removeToast } = useToast();
  const isEdit = mode === "edit";
  const canResetPassword = useIamAccess().hasPrefix(IAM.settingsUsers);

  const { data: detailRes, isLoading: detailLoading } = useUserDetail(
    isEdit && employeeId ? employeeId : null
  );
  const { data: businessTreeData } = useBusinessTree();
  const businessTree = businessTreeData ?? { holdings: [] };
  const { data: lookups } = useUserFormLookups();
  const createMutation = useCreateUser();
  const updateMutation = useUpdateUser();

  const [form, setForm] = useState<UserEmployeeFormValues>(emptyUserForm);
  const formInitializedRef = useRef(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  const departments = lookups?.departments ?? [];
  const sections = lookups?.sections ?? [];
  const positions = lookups?.positions ?? [];
  const managers = lookups?.managers ?? [];
  const employmentStatuses = lookups?.employmentStatuses ?? [];

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  useEffect(() => {
    if (isEdit && detailRes?.data && !formInitializedRef.current) {
      setForm(toFormValues(detailRes.data));
      formInitializedRef.current = true;
    }
  }, [isEdit, detailRes?.data]);

  const hasExistingAppAccount = Boolean(detailRes?.data?.userId);

  const selectedDeptName = departments.find((d) => d.id === form.department_id)?.name;
  const filteredPositions = useMemo(
    () =>
      form.department_id
        ? positions.filter((p) => p.department === selectedDeptName)
        : [],
    [form.department_id, positions, selectedDeptName]
  );

  const genderOptions = useMemo(
    () => GENDER_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
    []
  );
  const employmentStatusOptions = useMemo(
    () => employmentStatuses.map((o) => ({ value: o.code, label: o.name })),
    [employmentStatuses]
  );
  const departmentOptions = useMemo(
    () => departments.map((d) => ({ value: d.id, label: d.name })),
    [departments]
  );
  const positionOptions = useMemo(
    () => filteredPositions.map((p) => ({ value: p.id, label: p.title, description: p.department })),
    [filteredPositions]
  );
  const sectionOptions = useMemo(
    () => sections.map((s) => ({ value: s.id, label: s.name })),
    [sections]
  );
  const managerOptions = useMemo(
    () =>
      managers.map((m) => ({
        value: m.id,
        label: m.full_name,
        description: m.nip,
      })),
    [managers]
  );

  function setField(patch: Partial<UserEmployeeFormValues>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  async function handleSubmit() {
    if (!form.full_name || !form.email || !form.join_date || !form.employment_status) {
      showToast("Full name, email, join date, and employment status are required", "error");
      return;
    }

    if (form.is_access_app) {
      const needsNewPassword = !isEdit || !hasExistingAppAccount;
      if (needsNewPassword && form.password.length < 8) {
        showToast("Password must be at least 8 characters for app access", "error");
        return;
      }
      if (!form.role) {
        showToast("Role is required for app access", "error");
        return;
      }
      if (form.role !== "super_admin" && !form.business_scope) {
        showToast("Data access scope is required", "error");
        return;
      }
      if (form.role !== "super_admin" && form.business_scope === "holding" && !form.holding_id) {
        showToast("Holding is required", "error");
        return;
      }
      if (
        form.role !== "super_admin" &&
        form.business_scope === "company" &&
        (!form.holding_id || !form.company_id)
      ) {
        showToast("Holding and company are required", "error");
        return;
      }
      if (
        form.role !== "super_admin" &&
        form.business_scope === "branch" &&
        (!form.holding_id || !form.company_id || !form.branch_id)
      ) {
        showToast("Holding, company, and branch are required", "error");
        return;
      }
      if (
        form.role !== "super_admin" &&
        form.business_scope === "branch" &&
        !form.default_warehouse_id
      ) {
        showToast("Pilih stall default untuk scope branch", "error");
        return;
      }
    }

    const invalidWorkflow = form.approval_permissions.some((permission) =>
      workflowsForModule(permission.module).every((w) => w.value !== permission.workflow)
    );
    if (invalidWorkflow) {
      showToast("Approval workflow must match the selected module", "error");
      return;
    }

    const payload = buildPayload(form, isEdit);

    try {
      if (isEdit && employeeId) {
        const res = await updateMutation.mutateAsync({ id: employeeId, ...payload });
        showToast(res.message || "Employee updated successfully", "success");
        router.push(EMPLOYEES_ROUTES.detail(employeeId));
      } else {
        const res = await createMutation.mutateAsync(payload as Parameters<typeof createMutation.mutateAsync>[0]);
        showToast(res.message || "Employee created successfully", "success");
        router.push(EMPLOYEES_ROUTES.detail(res.data.id));
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to save data", "error");
    }
  }

  const backHref =
    isEdit && employeeId
      ? EMPLOYEES_ROUTES.detail(employeeId)
      : EMPLOYEES_ROUTES.list;

  if (isEdit && detailLoading) {
    return <FormPageLoading />;
  }

  return (
    <FormPageLayout>
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Link href={backHref}>
            <Button variant="ghost" size="icon" className="h-9 w-9 text-gray-600">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {isEdit ? "Edit Employee" : "Add Employee"}
            </h1>
            <p className="text-sm text-gray-500">
              Employment data and app access in one form
            </p>
          </div>
        </div>
        <Link href={backHref}>
          <Button variant="outline" className="h-10 rounded-lg border-gray-200/80">
            Back
          </Button>
        </Link>
      </div>

      <FormPageBody>
        <FormSectionCard
          icon={UserCircleIcon}
          title="Personal Information"
          description="Basic identity and contact details."
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2">
              <FormFieldLabel required>Full Name</FormFieldLabel>
              <Input
                value={form.full_name}
                onChange={(e) => setField({ full_name: e.target.value })}
                className={formInputClassName}
              />
            </div>
            <div className="sm:col-span-2">
              <FormFieldLabel required>Email</FormFieldLabel>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setField({ email: e.target.value })}
                className={formInputClassName}
              />
            </div>
            <div>
              <FormFieldLabel>Phone</FormFieldLabel>
              <Input
                value={form.phone}
                onChange={(e) => setField({ phone: e.target.value })}
                className={formInputClassName}
              />
            </div>
            <div>
              <FormFieldLabel>NIK / KTP</FormFieldLabel>
              <Input
                value={form.ktp}
                onChange={(e) => setField({ ktp: e.target.value })}
                className={formInputClassName}
              />
            </div>
            <div>
              <FormFieldLabel>Date of Birth</FormFieldLabel>
              <Input
                type="date"
                value={form.birth_date}
                onChange={(e) => setField({ birth_date: e.target.value })}
                className={formInputClassName}
              />
            </div>
            <div>
              <FormFieldLabel>Gender</FormFieldLabel>
              <Combobox
                options={genderOptions}
                value={form.gender}
                onChange={(value) => setField({ gender: value })}
                placeholder="Select"
                searchPlaceholder="Search..."
                emptyMessage="Not found"
                allowClear
                className={formComboboxClassName}
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-4">
              <FormFieldLabel>Address</FormFieldLabel>
              <Input
                value={form.address}
                onChange={(e) => setField({ address: e.target.value })}
                className={formInputClassName}
              />
            </div>
          </div>
        </FormSectionCard>

        <FormSectionCard
          icon={BriefcaseIcon}
          title="Employment Details"
          description="Internal organization placement and employment status."
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <FormFieldLabel required>Join Date</FormFieldLabel>
              <Input
                type="date"
                value={form.join_date}
                onChange={(e) => setField({ join_date: e.target.value })}
                className={formInputClassName}
              />
            </div>
            <div>
              <FormFieldLabel required>Employment Status</FormFieldLabel>
              <Combobox
                options={employmentStatusOptions}
                value={form.employment_status}
                onChange={(value) => setField({ employment_status: value })}
                placeholder="Select"
                searchPlaceholder="Search status..."
                emptyMessage="No status found"
                className={formComboboxClassName}
              />
            </div>
            <div>
              <FormFieldLabel>Department</FormFieldLabel>
              <Combobox
                options={departmentOptions}
                value={form.department_id}
                onChange={(value) => setField({ department_id: value, job_title_id: "" })}
                placeholder="Select"
                searchPlaceholder="Search department..."
                emptyMessage="No department found"
                allowClear
                className={formComboboxClassName}
              />
            </div>
            <div>
              <FormFieldLabel>Position</FormFieldLabel>
              <Combobox
                options={positionOptions}
                value={form.job_title_id}
                onChange={(value) => setField({ job_title_id: value })}
                placeholder="Select"
                searchPlaceholder="Search position..."
                emptyMessage="No position found"
                disabled={!form.department_id}
                allowClear
                className={formComboboxClassName}
              />
            </div>
            <div>
              <FormFieldLabel>Section</FormFieldLabel>
              <Combobox
                options={sectionOptions}
                value={form.section_id}
                onChange={(value) => setField({ section_id: value })}
                placeholder="Select"
                searchPlaceholder="Search section..."
                emptyMessage="No section found"
                allowClear
                className={formComboboxClassName}
              />
            </div>
            <div>
              <FormFieldLabel>Manager</FormFieldLabel>
              <Combobox
                options={managerOptions}
                value={form.reporting_to}
                onChange={(value) => setField({ reporting_to: value })}
                placeholder="Select"
                searchPlaceholder="Search manager..."
                emptyMessage="No manager found"
                allowClear
                className={formComboboxClassName}
              />
            </div>
          </div>
        </FormSectionCard>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <FormSectionCard icon={BanknotesIcon} title="Bank & BPJS" bodyClassName="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <FormFieldLabel>Bank</FormFieldLabel>
                <Input
                  value={form.bank_name}
                  onChange={(e) => setField({ bank_name: e.target.value })}
                  className={formInputClassName}
                />
              </div>
              <div>
                <FormFieldLabel>Account Number</FormFieldLabel>
                <Input
                  value={form.bank_account}
                  onChange={(e) => setField({ bank_account: e.target.value })}
                  className={formInputClassName}
                />
              </div>
            </div>
          </FormSectionCard>

          <FormSectionCard icon={PhoneIcon} title="Emergency Contact" bodyClassName="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <FormFieldLabel>Name</FormFieldLabel>
                <Input
                  value={form.emergency_contact_name}
                  onChange={(e) => setField({ emergency_contact_name: e.target.value })}
                  className={formInputClassName}
                />
              </div>
              <div>
                <FormFieldLabel>Phone</FormFieldLabel>
                <Input
                  value={form.emergency_contact_phone}
                  onChange={(e) => setField({ emergency_contact_phone: e.target.value })}
                  className={formInputClassName}
                />
              </div>
            </div>
          </FormSectionCard>
        </div>

        <FormSectionCard
          icon={ShieldCheck}
          title="App Access"
          description="NüHabit login, role, business scope, and approval permissions."
          bodyClassName="p-0"
        >
          <div className="px-5 py-5">
            <AppAccessFormSection
              form={form}
              businessTree={businessTree}
              isEdit={isEdit}
              hasExistingAppAccount={hasExistingAppAccount}
              onChange={setField}
              onResetPassword={
                isEdit && employeeId && canResetPassword && hasExistingAppAccount
                  ? () => setResetDialogOpen(true)
                  : undefined
              }
            />
          </div>
        </FormSectionCard>
      </FormPageBody>

      <FormPageFooter>
        <Button
          variant="outline"
          onClick={() => router.push(backHref)}
          disabled={isSubmitting}
          className="h-10 rounded-lg border-gray-200/80"
        >
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="h-10 gap-2 rounded-lg bg-pink-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-pink-700"
        >
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {isSubmitting ? "Saving..." : isEdit ? "Save Changes" : "Add Employee"}
        </Button>
      </FormPageFooter>

      {isEdit && employeeId ? (
        <ResetPasswordDialog
          target={{ id: employeeId, fullName: form.full_name || detailRes?.data?.fullName || "Employee" }}
          open={resetDialogOpen}
          onOpenChange={setResetDialogOpen}
          onError={(message) => showToast(message, "error")}
        />
      ) : null}
    </FormPageLayout>
  );
}

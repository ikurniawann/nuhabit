"use client";

import { Combobox } from "@/components/ui/combobox";
import type { BusinessTree } from "@/features/configuration/business/types";
import { FormFieldLabel, formComboboxClassName } from "@/components/layout/form-field";
import {
  BUSINESS_SCOPE_DESCRIPTIONS,
  BUSINESS_SCOPE_LABELS,
  type BusinessScopeLevel,
} from "@/lib/configuration/business-scope";
import type { UserEmployeeFormValues } from "../types";

interface BusinessScopePickerProps {
  form: Pick<
    UserEmployeeFormValues,
    "business_scope" | "holding_id" | "company_id" | "branch_id" | "role"
  >;
  tree: BusinessTree;
  isEdit?: boolean;
  onChange: (patch: Partial<UserEmployeeFormValues>) => void;
}

const SCOPE_OPTIONS = [
  { value: "holding", label: BUSINESS_SCOPE_LABELS.holding },
  { value: "company", label: BUSINESS_SCOPE_LABELS.company },
  { value: "branch", label: BUSINESS_SCOPE_LABELS.branch },
];

export function BusinessScopePicker({
  form,
  tree,
  isEdit = false,
  onChange,
}: BusinessScopePickerProps) {
  const isSuperAdmin = form.role === "super_admin";
  const scope = form.business_scope as BusinessScopeLevel | "";
  const showScopePickers = !isSuperAdmin || isEdit;

  const holdings = tree.holdings;
  const companies = holdings.find((h) => h.id === form.holding_id)?.companies ?? [];
  const branches = companies.find((c) => c.id === form.company_id)?.branches ?? [];

  const holdingOptions = holdings.map((holding) => ({
    value: holding.id,
    label: holding.name,
  }));
  const companyOptions = companies.map((company) => ({
    value: company.id,
    label: company.name,
  }));
  const branchOptions = branches.map((branch) => ({
    value: branch.id,
    label: branch.name,
  }));

  function handleScopeChange(value: string) {
    const nextScope = value as BusinessScopeLevel;
    onChange({
      business_scope: nextScope,
      holding_id: "",
      company_id: "",
      branch_id: "",
      warehouse_ids: [],
      default_warehouse_id: "",
    });
  }

  function handleHoldingChange(value: string) {
    onChange({
      holding_id: value,
      company_id: "",
      branch_id: "",
      warehouse_ids: [],
      default_warehouse_id: "",
    });
  }

  function handleCompanyChange(value: string) {
    onChange({
      company_id: value,
      branch_id: "",
      warehouse_ids: [],
      default_warehouse_id: "",
    });
  }

  if (isSuperAdmin && !showScopePickers) {
    return (
      <div className="rounded-lg border border-gray-200/70 bg-gray-50/50 p-4">
        <p className="text-sm font-medium text-gray-900">Data Access Scope</p>
        <p className="mt-1 text-xs text-gray-500">
          Super Admin has full access across all holdings, companies, and branches. Change the role
          first if you want to limit data scope.
        </p>
      </div>
    );
  }

  if (isSuperAdmin && showScopePickers) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-amber-200/80 bg-amber-50/60 p-4">
          <p className="text-sm font-medium text-amber-900">Data Access Scope</p>
          <p className="mt-1 text-xs text-amber-800">
            Current role is Super Admin. Scope below is only saved when the role is changed to
            something other than Super Admin.
          </p>
        </div>
        {renderScopeFields()}
      </div>
    );
  }

  return renderScopeFields();

  function renderScopeFields() {
    return (
      <div className="space-y-4 rounded-lg border border-gray-200/70 bg-gray-50/50 p-4">
        <div>
          <FormFieldLabel required>Data Access Scope</FormFieldLabel>
          <Combobox
            options={SCOPE_OPTIONS}
            value={scope || ""}
            onChange={handleScopeChange}
            placeholder="Select scope"
            searchPlaceholder="Search scope..."
            emptyMessage="No scope found"
            className={formComboboxClassName}
          />
          {scope ? (
            <p className="mt-1.5 text-xs text-gray-500">{BUSINESS_SCOPE_DESCRIPTIONS[scope]}</p>
          ) : null}
        </div>

        {scope ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <FormFieldLabel required>Holding</FormFieldLabel>
              <Combobox
                options={holdingOptions}
                value={form.holding_id || ""}
                onChange={handleHoldingChange}
                placeholder="Select holding"
                searchPlaceholder="Search holding..."
                emptyMessage="No holding found"
                className={formComboboxClassName}
              />
            </div>

            {scope === "company" || scope === "branch" ? (
              <div>
                <FormFieldLabel required>Company</FormFieldLabel>
                <Combobox
                  options={companyOptions}
                  value={form.company_id || ""}
                  onChange={handleCompanyChange}
                  placeholder="Select company"
                  searchPlaceholder="Search company..."
                  emptyMessage="No company found"
                  disabled={!form.holding_id}
                  className={formComboboxClassName}
                />
              </div>
            ) : null}

            {scope === "branch" ? (
              <div>
                <FormFieldLabel required>Branch</FormFieldLabel>
                <Combobox
                  options={branchOptions}
                  value={form.branch_id || ""}
                  onChange={(value) =>
                    onChange({
                      branch_id: value,
                      warehouse_ids: [],
                      default_warehouse_id: "",
                    })
                  }
                  placeholder="Select branch"
                  searchPlaceholder="Search branch..."
                  emptyMessage="No branch found"
                  disabled={!form.company_id}
                  className={formComboboxClassName}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }
}

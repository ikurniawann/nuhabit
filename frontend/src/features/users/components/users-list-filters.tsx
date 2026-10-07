"use client";

import type { ReactNode } from "react";
import { Combobox } from "@/components/ui/combobox";
import { filterComboboxClassName } from "@/components/layout/form-field";
import { ROLE_OPTIONS, STATUS_LABELS } from "../constants";

export interface UserListFilters {
  department: string;
  status: string;
  active: string;
  access: string;
  /** "" = semua role */
  role: string;
}

export const DEFAULT_USER_LIST_FILTERS: UserListFilters = {
  department: "all",
  status: "all",
  active: "all",
  access: "all",
  role: "",
};

export function countActiveFilters(filters: UserListFilters): number {
  return [
    filters.department !== "all",
    filters.status !== "all",
    filters.active !== "all",
    filters.access !== "all",
    Boolean(filters.role),
  ].filter(Boolean).length;
}

const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All Statuses" },
  ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
];
const ACTIVE_FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "true", label: "Active" },
  { value: "false", label: "Inactive" },
];
const ACCESS_FILTER_OPTIONS = [
  { value: "all", label: "All Access" },
  { value: "true", label: "With App Access" },
  { value: "false", label: "Without App Access" },
];
const ROLE_FILTER_OPTIONS = [{ value: "all", label: "All Roles" }, ...ROLE_OPTIONS];

interface UsersListFiltersPanelProps {
  filters: UserListFilters;
  departments: { id: string; name: string }[];
  showRole: boolean;
  onChange: (patch: Partial<UserListFilters>) => void;
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      {children}
    </div>
  );
}

export function UsersListFiltersPanel({
  filters,
  departments,
  showRole,
  onChange,
}: UsersListFiltersPanelProps) {
  const departmentOptions = [
    { value: "all", label: "All Departments" },
    ...departments.map((d) => ({ value: d.id, label: d.name })),
  ];

  return (
    <div className="border-b border-gray-100 bg-gray-50/70 px-5 py-4">
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <FilterField label="Department">
          <Combobox
            options={departmentOptions}
            value={filters.department}
            onChange={(department) => onChange({ department })}
            placeholder="Department"
            searchPlaceholder="Search department..."
            emptyMessage="No department found"
            className={filterComboboxClassName}
          />
        </FilterField>
        <FilterField label="Status">
          <Combobox
            options={STATUS_FILTER_OPTIONS}
            value={filters.status}
            onChange={(status) => onChange({ status })}
            placeholder="Status"
            searchPlaceholder="Search status..."
            emptyMessage="No status found"
            className={filterComboboxClassName}
          />
        </FilterField>
        <FilterField label="Activity">
          <Combobox
            options={ACTIVE_FILTER_OPTIONS}
            value={filters.active}
            onChange={(active) => onChange({ active })}
            placeholder="Active"
            searchPlaceholder="Search..."
            emptyMessage="Not found"
            className={filterComboboxClassName}
          />
        </FilterField>
        <FilterField label="App Access">
          <Combobox
            options={ACCESS_FILTER_OPTIONS}
            value={filters.access}
            onChange={(access) => onChange({ access })}
            placeholder="App Access"
            searchPlaceholder="Search..."
            emptyMessage="Not found"
            className={filterComboboxClassName}
          />
        </FilterField>
        {showRole ? (
          <FilterField label="Role">
            <Combobox
              options={ROLE_FILTER_OPTIONS}
              value={filters.role || "all"}
              onChange={(value) => onChange({ role: value === "all" ? "" : value })}
              placeholder="Role"
              searchPlaceholder="Search role..."
              emptyMessage="No role found"
              className={filterComboboxClassName}
            />
          </FilterField>
        ) : null}
      </div>
    </div>
  );
}

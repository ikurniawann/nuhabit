"use client";

import { Badge } from "@/components/ui/badge";
import type { RoleDetail } from "../types";
import { formatDateTime } from "@/lib/format";

interface RoleDetailSectionsProps {
  detail: RoleDetail;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </p>
      <div className="text-sm text-gray-900">{value}</div>
    </div>
  );
}

export function RoleDetailSections({ detail }: RoleDetailSectionsProps) {
  const grantedPermissions = detail.permissions.filter((p) => p.isGranted);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200/70 bg-gray-50/50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              {detail.name}
            </h3>
            <p className="mt-1 font-mono text-xs text-gray-500">
              {detail.code}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge
              className={
                detail.isSystem
                  ? "bg-blue-100 text-blue-700"
                  : "bg-gray-100 text-gray-600"
              }
            >
              {detail.isSystem ? "System" : "Custom"}
            </Badge>
            <Badge
              className={
                detail.isActive
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-gray-100 text-gray-500"
              }
            >
              {detail.isActive ? "Active" : "Inactive"}
            </Badge>
          </div>
        </div>
        {detail.description ? (
          <p className="mt-3 text-sm text-gray-600">{detail.description}</p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Menu Permissions"
          value={`${detail.menuPermissionCount} menus`}
        />
        <Field
          label="Granted Access"
          value={`${grantedPermissions.length} menus`}
        />
      </div>

      {grantedPermissions.length > 0 ? (
        <div className="space-y-3 rounded-xl border border-gray-200/70 p-4">
          <p className="text-sm font-semibold text-gray-900">
            Granted Menu Access
          </p>
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {grantedPermissions.map((permission) => (
              <div
                key={permission.menuId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200/60 bg-white px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {permission.menuName}
                  </p>
                  <p className="font-mono text-xs text-gray-500">
                    {permission.menuCode}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {(permission.grantedActions.length > 0
                    ? permission.grantedActions
                    : ["read"]
                  ).map((action) => (
                    <Badge
                      key={action}
                      className="border border-pink-200 bg-pink-50 capitalize text-pink-700"
                    >
                      {action}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200/70 p-4 text-sm text-gray-500">
          No menu permissions assigned yet.
        </div>
      )}

      <div className="grid gap-4 text-xs text-gray-500 sm:grid-cols-2">
        <Field
          label="Created At"
          value={formatDateTime(detail.createdAt)}
        />
        <Field
          label="Updated At"
          value={
            detail.updatedAt
              ? formatDateTime(detail.updatedAt)
              : "—"
          }
        />
        <Field label="Version" value={detail.version} />
      </div>
    </div>
  );
}

"use client";

import { Badge } from "@/components/ui/badge";
import type { MenuDetail } from "@/lib/iam/menu-types";
import { formatDateTime } from "@/lib/format";

interface MenuDetailSectionsProps {
  detail: MenuDetail;
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

export function MenuDetailSections({ detail }: MenuDetailSectionsProps) {
  const actions =
    detail.permissionContext?.actions &&
    detail.permissionContext.actions.length > 0
      ? detail.permissionContext.actions
      : ["read"];

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200/70 bg-gray-50/50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              {detail.menuName}
            </h3>
            <p className="mt-1 font-mono text-xs text-gray-500">
              {detail.code}
            </p>
          </div>
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

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Route" value={detail.routePath ?? "—"} />
        <Field label="Module" value={detail.module ?? "—"} />
        <Field label="Menu Type" value={detail.menuType} />
        <Field label="Icon" value={detail.icon ?? "—"} />
        <Field label="Level" value={detail.level} />
        <Field label="Order" value={detail.orderNumber} />
        <Field
          label="Visibility"
          value={detail.isVisible ? "Visible" : "Hidden"}
        />
        <Field
          label="Open in New Tab"
          value={detail.openInNewTab ? "Yes" : "No"}
        />
      </div>

      <div className="space-y-3 rounded-xl border border-gray-200/70 p-4">
        <p className="text-sm font-semibold text-gray-900">
          Permission Context
        </p>
        <div className="flex flex-wrap gap-2">
          {actions.map((action) => (
            <Badge
              key={action}
              className="border border-pink-200 bg-pink-50 capitalize text-pink-700"
            >
              {action}
            </Badge>
          ))}
        </div>
        {detail.description && (
          <p className="text-sm text-gray-500">{detail.description}</p>
        )}
      </div>

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

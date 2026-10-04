"use client";

import {
  EyeIcon,
  KeyIcon,
  PencilIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableRow } from "@/components/ui/table";
import type { RoleItem } from "../types";

interface RolesTableProps {
  rows: RoleItem[];
  selectedId: string | null;
  onView: (id: string) => void;
  onEdit: (item: RoleItem) => void;
  onDelete: (item: RoleItem) => void;
  onManagePermissions: (item: RoleItem) => void;
}

export function RolesTable({
  rows,
  selectedId,
  onView,
  onEdit,
  onDelete,
  onManagePermissions,
}: RolesTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <TableRow className="border-b border-gray-200/70 bg-gray-50/80 text-xs uppercase tracking-wide text-gray-500 hover:bg-gray-50/80">
            <th className="px-4 py-3 text-left font-semibold">Role</th>
            <th className="px-4 py-3 text-left font-semibold">Code</th>
            <th className="px-4 py-3 text-left font-semibold">Description</th>
            <th className="px-4 py-3 text-left font-semibold">Menu Access</th>
            <th className="px-4 py-3 text-left font-semibold">Type</th>
            <th className="px-4 py-3 text-left font-semibold">Status</th>
            <th className="px-4 py-3 text-right font-semibold">Actions</th>
          </TableRow>
        </thead>
        <tbody className="divide-y divide-gray-200/50">
          {rows.map((row) => (
            <TableRow
              key={row.id}
              className={`transition-colors hover:bg-gray-50/80 ${
                selectedId === row.id ? "bg-pink-50/60" : ""
              }`}
            >
              <td className="px-4 py-3 font-medium text-gray-900">
                {row.name}
              </td>
              <td className="px-4 py-3">
                <span className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs">
                  {row.code}
                </span>
              </td>
              <td className="max-w-xs truncate px-4 py-3 text-gray-500">
                {row.description ?? "—"}
              </td>
              <td className="px-4 py-3 text-gray-700">
                {row.menuPermissionCount} menus
              </td>
              <td className="px-4 py-3">
                <Badge
                  className={
                    row.isSystem
                      ? "bg-blue-100 text-blue-700"
                      : "bg-gray-100 text-gray-600"
                  }
                >
                  {row.isSystem ? "System" : "Custom"}
                </Badge>
              </td>
              <td className="px-4 py-3">
                <Badge
                  className={
                    row.isActive
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-gray-100 text-gray-500"
                  }
                >
                  {row.isActive ? "Active" : "Inactive"}
                </Badge>
              </td>
              <td className="px-4 py-3 text-right">
                <div className="flex items-center justify-end gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="cursor-pointer p-1.5 text-gray-600"
                    aria-label={`View details for ${row.name}`}
                    onClick={() => onView(row.id)}
                  >
                    <EyeIcon className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="cursor-pointer p-1.5 text-violet-600"
                    aria-label={`Manage permissions for ${row.name}`}
                    onClick={() => onManagePermissions(row)}
                  >
                    <KeyIcon className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="cursor-pointer p-1.5 text-blue-600"
                    aria-label={`Edit ${row.name}`}
                    onClick={() => onEdit(row)}
                  >
                    <PencilIcon className="h-4 w-4" />
                  </Button>
                  {!row.isSystem ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="cursor-pointer p-1.5 text-red-500 hover:text-red-600"
                      aria-label={`Delete ${row.name}`}
                      onClick={() => onDelete(row)}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              </td>
            </TableRow>
          ))}
        </tbody>
      </table>
    </div>
  );
}

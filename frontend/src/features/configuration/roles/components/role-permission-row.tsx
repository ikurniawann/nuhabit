"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { AppSidebarNavIcon } from "@/components/shared/app-sidebar-nav-icons";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { TableRow } from "@/components/ui/table";
import type { NavIconName } from "@/lib/iam/types";
import { type FlatMenuTreeRow } from "@/features/configuration/menus/utils/menu-tree";
import type { RoleMenuPermission } from "../types";

const MODULE_ICON: Record<string, NavIconName> = {
  dashboard: "home",
  hris: "users",
  purchasing: "shopping",
  items: "cube",
  inventory: "database",
  finance: "money",
  accounting: "reports",
  pos: "shopping",
  crm: "star",
  business: "building",
  "user-management": "users",
};

function iconForPermission(
  permission: RoleMenuPermission,
  isGroup: boolean,
): NavIconName {
  const root = permission.menuCode.split(".")[0];
  if (permission.level <= 1 && MODULE_ICON[root]) {
    return MODULE_ICON[root];
  }
  return isGroup ? "sitemap" : "clipboard";
}

export interface PermissionRowProps {
  row: FlatMenuTreeRow;
  permission: RoleMenuPermission;
  expandedIds: Set<string>;
  checkState: boolean;
  onToggleExpand: (id: string) => void;
  onToggleGrant: (menuId: string, granted: boolean) => void;
  onToggleAction: (menuId: string, action: string) => void;
}

export function PermissionRow({
  row,
  permission,
  expandedIds,
  checkState,
  onToggleExpand,
  onToggleGrant,
  onToggleAction,
}: PermissionRowProps) {
  const { item, depth, hasChildren } = row;
  const isExpanded = expandedIds.has(item.id);
  const isGroup = item.menuType === "group" || hasChildren;
  const isTopLevel = depth === 0;
  const availableActions =
    permission.availableActions.length > 0
      ? permission.availableActions
      : ["read"];
  const grantedActions =
    permission.grantedActions.length > 0 ? permission.grantedActions : ["read"];
  const iconName = iconForPermission(permission, isGroup);
  const indent = depth * 20;

  return (
    <TableRow
      className={cn(
        "border-b border-gray-200/50 transition-colors hover:bg-gray-50/80",
        isTopLevel && "bg-gray-50/60 hover:bg-gray-50",
        permission.isGranted &&
          !isTopLevel &&
          "bg-pink-50/30 hover:bg-pink-50/50",
        permission.isGranted &&
          isTopLevel &&
          "bg-pink-50/40 hover:bg-pink-50/60",
      )}
    >
      <td className="px-4 py-3 align-middle">
        <div
          className="flex min-w-0 items-center gap-2"
          style={{ paddingLeft: indent }}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={() => onToggleExpand(item.id)}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-200/70 hover:text-gray-600"
              aria-expanded={isExpanded}
              aria-label={isExpanded ? "Collapse" : "Expand"}
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          ) : (
            <span className="inline-block h-6 w-6 shrink-0" aria-hidden />
          )}

          <span
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-200/70 bg-white text-gray-600",
              permission.isGranted &&
                "border-pink-200/80 bg-pink-50 text-pink-700",
            )}
          >
            <AppSidebarNavIcon
              name={iconName}
              className="h-4 w-4"
              isActive={false}
            />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Checkbox
                id={`grant-${item.id}`}
                checked={checkState}
                onCheckedChange={(checked) =>
                  onToggleGrant(item.id, checked === true)
                }
              />
              <label
                htmlFor={`grant-${item.id}`}
                className={cn(
                  "cursor-pointer truncate text-sm text-gray-900",
                  isGroup || isTopLevel ? "font-semibold" : "font-medium",
                )}
              >
                {item.menuName}
              </label>
              {isGroup ? (
                <Badge className="border-0 bg-gray-100 px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide text-gray-500">
                  Group
                </Badge>
              ) : (
                <Badge className="border-0 bg-gray-100 px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide text-gray-500">
                  {item.menuType}
                </Badge>
              )}
            </div>
            <p className="mt-0.5 truncate pl-6 font-mono text-[11px] text-gray-400">
              {permission.menuCode}
            </p>
          </div>
        </div>
      </td>

      <td className="px-4 py-3 align-middle">
        {permission.isGranted ? (
          <div className="flex flex-wrap justify-end gap-1.5 sm:justify-start">
            {availableActions.map((action) => {
              const selected = grantedActions.includes(action);
              return (
                <button
                  key={action}
                  type="button"
                  onClick={() => onToggleAction(item.id, action)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                    selected
                      ? "border-pink-200 bg-pink-50 text-pink-700"
                      : "border-gray-200/70 bg-white text-gray-500 hover:border-gray-300 hover:bg-gray-50",
                  )}
                >
                  {action}
                </button>
              );
            })}
          </div>
        ) : (
          <span className="text-xs text-gray-400">—</span>
        )}
      </td>
    </TableRow>
  );
}

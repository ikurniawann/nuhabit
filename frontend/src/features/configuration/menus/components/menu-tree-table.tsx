"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  GripVertical,
  Link2,
  MoreVertical,
} from "lucide-react";
import { EyeIcon, PencilIcon, TrashIcon } from "@heroicons/react/24/outline";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MenuItem } from "@/lib/iam/menu-types";
import type { FlatMenuTreeRow } from "../utils/menu-tree";

interface MenuTreeTableProps {
  rows: FlatMenuTreeRow[];
  expandedIds: Set<string>;
  selectedId: string | null;
  reorderingId: string | null;
  onToggleExpand: (id: string) => void;
  onView: (id: string) => void;
  onEdit: (item: MenuItem) => void;
  onDelete: (item: MenuItem) => void;
  onReorder: (item: MenuItem, direction: "up" | "down") => void;
  onChangeOrder: (item: MenuItem, orderNumber: number) => void;
}

function OrderInput({
  item,
  disabled,
  saving,
  onChangeOrder,
}: {
  item: MenuItem;
  disabled: boolean;
  saving: boolean;
  onChangeOrder: (item: MenuItem, orderNumber: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? String(item.orderNumber);

  function commit() {
    const next = Number.parseInt(value, 10);
    setDraft(null);
    if (Number.isNaN(next) || next < 0 || next === item.orderNumber) return;
    onChangeOrder(item, next);
  }

  if (saving) {
    return (
      <span className="flex w-12 items-center justify-center">
        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-200 border-t-primary" />
      </span>
    );
  }

  return (
    <Input
      type="number"
      min={0}
      value={value}
      disabled={disabled}
      onFocus={() => setDraft(String(item.orderNumber))}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        }
        if (e.key === "Escape") {
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
      onClick={(e) => e.stopPropagation()}
      aria-label={`Order for ${item.menuName}`}
      className="h-8 w-12 rounded-none border-0 bg-transparent px-1 text-center text-sm shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
    />
  );
}

export function MenuTreeTable({
  rows,
  expandedIds,
  selectedId,
  reorderingId,
  onToggleExpand,
  onView,
  onEdit,
  onDelete,
  onReorder,
  onChangeOrder,
}: MenuTreeTableProps) {
  const isReordering = reorderingId !== null;

  return (
    <div>
      <div className="flex items-center justify-between border-b border-gray-200/70 bg-gray-50/80 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
        <span>Menu Structure</span>
        <span className="pr-12">Order</span>
      </div>

      <ul className="divide-y divide-gray-200/50">
        {rows.map(
          ({ item, depth, hasChildren, childrenCount, isFirst, isLast }) => {
            const isExpanded = expandedIds.has(item.id);
            const isGroup = item.menuType === "group" || hasChildren;
            const isRowReordering = reorderingId === item.id;

            return (
              <li
                key={item.id}
                className={`group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50/80 ${
                  selectedId === item.id ? "bg-primary/5" : ""
                }`}
                style={{ paddingLeft: `${16 + depth * 28}px` }}
              >
                {hasChildren ? (
                  <button
                    type="button"
                    onClick={() => onToggleExpand(item.id)}
                    className="shrink-0 rounded-md p-1 text-gray-400 transition hover:bg-gray-200/70 hover:text-gray-600"
                    aria-expanded={isExpanded}
                    aria-label={
                      isExpanded
                        ? `Collapse ${item.menuName}`
                        : `Expand ${item.menuName}`
                    }
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </button>
                ) : (
                  <span className="shrink-0 p-1 text-gray-300" aria-hidden>
                    <GripVertical className="h-4 w-4" />
                  </span>
                )}

                <button
                  type="button"
                  onClick={() => onView(item.id)}
                  className="min-w-0 flex-1 text-left"
                  aria-label={`View details for ${item.menuName}`}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span
                      className={`truncate text-sm text-gray-900 ${
                        isGroup ? "font-semibold" : "font-medium"
                      }`}
                    >
                      {item.menuName}
                    </span>
                    <span className="rounded border border-gray-200/80 bg-gray-50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-gray-500">
                      {item.code}
                    </span>
                    <Badge
                      className={`border-0 font-normal ${
                        item.isActive
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {item.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </span>
                  <span className="mt-1 flex items-center gap-2 text-xs text-gray-400">
                    {item.routePath ? (
                      <span className="flex min-w-0 items-center gap-1">
                        <Link2 className="h-3 w-3 shrink-0" />
                        <span className="truncate" title={item.routePath}>
                          {item.routePath}
                        </span>
                      </span>
                    ) : (
                      <span className="italic">No route (group)</span>
                    )}
                    {hasChildren ? (
                      <span className="shrink-0">
                        {childrenCount} sub-menu{childrenCount > 1 ? "s" : ""}
                      </span>
                    ) : null}
                  </span>
                </button>

                <div className="flex shrink-0 items-center gap-1.5">
                  <div className="flex items-stretch overflow-hidden rounded-lg border border-gray-200/80 bg-white shadow-sm">
                    <OrderInput
                      item={item}
                      disabled={isReordering}
                      saving={isRowReordering}
                      onChangeOrder={onChangeOrder}
                    />
                    <div className="flex flex-col border-l border-gray-200/80">
                      <button
                        type="button"
                        onClick={() => onReorder(item, "up")}
                        disabled={isFirst || isReordering}
                        className="flex h-1/2 items-center px-1 text-gray-400 transition hover:bg-gray-50 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label={`Move ${item.menuName} up`}
                      >
                        <ChevronUp className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onReorder(item, "down")}
                        disabled={isLast || isReordering}
                        className="flex h-1/2 items-center border-t border-gray-200/80 px-1 text-gray-400 transition hover:bg-gray-50 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label={`Move ${item.menuName} down`}
                      >
                        <ChevronDown className="h-3 w-3" />
                      </button>
                    </div>
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                      aria-label={`Actions for ${item.menuName}`}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      <DropdownMenuItem onClick={() => onView(item.id)}>
                        <EyeIcon className="h-4 w-4" />
                        View details
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onEdit(item)}>
                        <PencilIcon className="h-4 w-4" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => onDelete(item)}
                      >
                        <TrashIcon className="h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </li>
            );
          },
        )}
      </ul>
    </div>
  );
}

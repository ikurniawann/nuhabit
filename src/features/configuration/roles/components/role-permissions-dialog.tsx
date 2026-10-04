"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { Loader2, Search } from "lucide-react";
import {
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
} from "@heroicons/react/24/outline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
  DialogPanelToolbar,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TableRow } from "@/components/ui/table";
import { buildMenuTree, collectExpandableIds, flattenMenuTree } from "@/features/configuration/menus/utils/menu-tree";
import { useRolePermissions } from "../queries";
import {
  buildChildrenByParent,
  getGrantChecked,
  permissionPayload,
  setGrantWithDescendants,
  toggleAction,
  visibleMenuItems,
} from "../permission-tree";
import { PermissionRow } from "./role-permission-row";
import type {
  RoleItem,
  RoleMenuPermission,
  RolePermissionUpdate,
} from "../types";

interface RolePermissionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: RoleItem | null;
  isSubmitting: boolean;
  onSubmit: (permissions: RolePermissionUpdate[]) => Promise<void>;
}

export function RolePermissionsDialog({
  open,
  onOpenChange,
  role,
  isSubmitting,
  onSubmit,
}: RolePermissionsDialogProps) {
  const roleId = role?.id ?? null;
  const { data, isLoading, isError } = useRolePermissions(open ? roleId : null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPanel
        size="xl"
        style={{ "--dialog-panel-max-height": "90vh" } as CSSProperties}
      >
        {open && data?.permissions ? (
          // Draft dipasang ulang per role yang dibuka.
          <RolePermissionsEditor
            key={roleId ?? "none"}
            role={role}
            initialPermissions={data.permissions}
            isSubmitting={isSubmitting}
            onSubmit={onSubmit}
            onCancel={() => onOpenChange(false)}
          />
        ) : (
          <>
            <DialogPanelHeader>
              <DialogPanelTitle>Manage Permissions</DialogPanelTitle>
              <DialogPanelDescription>
                Assign menu access and actions for this role
              </DialogPanelDescription>
            </DialogPanelHeader>
            <DialogPanelBody className="py-0">
              {isError ? (
                <p className="py-16 text-center text-sm text-gray-500">
                  Gagal memuat permissions
                </p>
              ) : isLoading ? (
                <div className="flex justify-center py-16">
                  <div className="h-7 w-7 animate-spin rounded-full border-2 border-gray-300 border-t-pink-500" />
                </div>
              ) : null}
            </DialogPanelBody>
          </>
        )}
      </DialogPanel>
    </Dialog>
  );
}

function RolePermissionsEditor({
  role,
  initialPermissions,
  isSubmitting,
  onSubmit,
  onCancel,
}: {
  role: RoleItem | null;
  initialPermissions: RoleMenuPermission[];
  isSubmitting: boolean;
  onSubmit: (permissions: RolePermissionUpdate[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(
    () => new Map(initialPermissions.map((p) => [p.menuId, { ...p }])),
  );
  const [search, setSearch] = useState("");
  // Node default terbuka; yang ditutup user dicatat di sini.
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  const permissions = useMemo(() => Array.from(draft.values()), [draft]);
  const childrenByParent = useMemo(
    () => buildChildrenByParent(permissions),
    [permissions],
  );
  const menuTree = useMemo(
    () => buildMenuTree(visibleMenuItems(permissions, search)),
    [permissions, search],
  );
  const expandableIds = useMemo(
    () => collectExpandableIds(menuTree),
    [menuTree],
  );
  const expandedIds = useMemo(
    () => new Set(expandableIds.filter((id) => !collapsedIds.has(id))),
    [expandableIds, collapsedIds],
  );
  const displayRows = useMemo(
    () => flattenMenuTree(menuTree, expandedIds),
    [menuTree, expandedIds],
  );

  function handleToggleGrant(menuId: string, granted: boolean) {
    setDraft((prev) => setGrantWithDescendants(prev, menuId, granted));
  }

  function handleToggleAction(menuId: string, action: string) {
    setDraft((prev) => {
      const current = prev.get(menuId);
      if (!current) return prev;
      return new Map(prev).set(menuId, toggleAction(current, action));
    });
  }

  function toggleExpand(id: string) {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleExpandAll() {
    setCollapsedIds(new Set());
  }

  function handleCollapseAll() {
    setCollapsedIds(new Set(expandableIds));
  }

  async function handleSave() {
    if (isSubmitting) return;
    await onSubmit(permissionPayload(permissions));
  }

  const grantedCount = permissions.filter((p) => p.isGranted).length;
  const totalCount = permissions.length;
  return (
    <>
      <DialogPanelHeader>
        <DialogPanelTitle>Manage Permissions</DialogPanelTitle>
        <DialogPanelDescription>
          {role
            ? `${role.name} (${role.code}) — ${grantedCount} dari ${totalCount} menu aktif`
            : "Assign menu access and actions for this role"}
        </DialogPanelDescription>
      </DialogPanelHeader>

      <DialogPanelToolbar className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Cari nama atau kode menu..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Badge className="border-0 bg-pink-50 px-2.5 py-1 text-pink-700">
            {grantedCount} granted
          </Badge>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={handleExpandAll}
            disabled={expandableIds.length === 0}
          >
            <ArrowsPointingOutIcon className="h-4 w-4" />
            Expand all
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={handleCollapseAll}
            disabled={expandedIds.size === 0}
          >
            <ArrowsPointingInIcon className="h-4 w-4" />
            Collapse all
          </Button>
        </div>
      </DialogPanelToolbar>

      <DialogPanelBody className="py-0">
        {displayRows.length === 0 ? (
          <p className="py-16 text-center text-sm text-gray-400">
            Menu tidak ditemukan
          </p>
        ) : (
          <div className="overflow-hidden border-y border-gray-200/70">
            <div className="max-h-[min(58vh,520px)] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-gray-50/95 backdrop-blur-sm">
                  <TableRow className="border-b border-gray-200/70 hover:bg-gray-50/95">
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Menu
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Actions
                    </th>
                  </TableRow>
                </thead>
                <tbody>
                  {displayRows.map((row) => {
                    const permission = draft.get(row.item.id);
                    if (!permission) return null;

                    const isGranted = getGrantChecked(
                      row.item.id,
                      draft,
                      childrenByParent,
                    );

                    return (
                      <PermissionRow
                        key={row.item.id}
                        row={row}
                        permission={permission}
                        expandedIds={expandedIds}
                        checkState={isGranted}
                        onToggleExpand={toggleExpand}
                        onToggleGrant={handleToggleGrant}
                        onToggleAction={handleToggleAction}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </DialogPanelBody>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Batal
        </Button>
        <Button
          type="button"
          className="bg-pink-600 text-white hover:bg-pink-700"
          onClick={handleSave}
          disabled={isSubmitting}
        >
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Simpan Permissions
        </Button>
      </DialogFooter>
    </>
  );
}

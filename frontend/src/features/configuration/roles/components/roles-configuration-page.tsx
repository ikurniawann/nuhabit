"use client";

import { useEffect, useMemo, useState } from "react";
import { PlusIcon, ShieldCheckIcon } from "@heroicons/react/24/outline";
import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  useCreateRole,
  useDeleteRole,
  useUpdateRole,
  useUpdateRolePermissions,
} from "../mutations";
import { useRoleDetail, useRoleList } from "../queries";
import type { CreateRolePayload, RoleItem } from "../types";
import { RoleDetailSections } from "./role-detail-sections";
import { RoleFormDialog } from "./role-form-dialog";
import { RolePermissionsDialog } from "./role-permissions-dialog";
import { RolesTable } from "./roles-table";
import { toast } from "sonner";

export function RolesConfigurationPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [formRoleId, setFormRoleId] = useState<string | null>(null);
  const [editingRole, setEditingRole] = useState<RoleItem | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingRole, setDeletingRole] = useState<RoleItem | null>(null);

  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [permissionsRole, setPermissionsRole] = useState<RoleItem | null>(null);

  const listParams = useMemo(
    () => ({
      search: search.trim() || undefined,
      status: statusFilter || undefined,
    }),
    [search, statusFilter],
  );

  const { data, isLoading, isError, error, refetch } = useRoleList(listParams);
  const createRoleMutation = useCreateRole();
  const updateRoleMutation = useUpdateRole();
  const deleteRoleMutation = useDeleteRole();
  const updatePermissionsMutation = useUpdateRolePermissions();

  const {
    data: detailData,
    isLoading: detailLoading,
    isError: detailError,
  } = useRoleDetail(selectedId);

  const allRows = useMemo(() => data?.data ?? [], [data?.data]);
  const isFormSubmitting =
    createRoleMutation.isPending || updateRoleMutation.isPending;
  const isDeleting = deleteRoleMutation.isPending;
  const isSavingPermissions = updatePermissionsMutation.isPending;

  useEffect(() => {
    if (isError) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load roles",
      );
    }
  }, [isError, error]);

  function handleView(id: string) {
    setSelectedId(id);
    setDetailOpen(true);
  }

  function handleDetailClose() {
    setDetailOpen(false);
    setSelectedId(null);
  }

  function handleOpenAdd() {
    setFormMode("create");
    setFormRoleId(null);
    setEditingRole(null);
    setFormOpen(true);
  }

  function handleOpenEdit(item: RoleItem) {
    setFormMode("edit");
    setFormRoleId(item.id);
    setEditingRole(item);
    setFormOpen(true);
  }

  function handleOpenDelete(item: RoleItem) {
    setDeletingRole(item);
    setDeleteOpen(true);
  }

  function handleOpenPermissions(item: RoleItem) {
    setPermissionsRole(item);
    setPermissionsOpen(true);
  }

  async function handleFormSubmit(payload: CreateRolePayload) {
    try {
      if (formMode === "edit" && formRoleId) {
        await updateRoleMutation.mutateAsync({ id: formRoleId, ...payload });
        toast.success("Role updated successfully");
      } else {
        await createRoleMutation.mutateAsync(payload);
        toast.success("Role added successfully");
      }
      setFormOpen(false);
      setFormRoleId(null);
      setEditingRole(null);
    } catch (submitError) {
      toast.error(
        submitError instanceof Error
          ? submitError.message
          : "Failed to save role",
      );
    }
  }

  async function handleConfirmDelete() {
    if (!deletingRole || isDeleting) return;

    try {
      await deleteRoleMutation.mutateAsync(deletingRole.id);
      toast.success("Role deleted successfully");
      setDeleteOpen(false);
      setDeletingRole(null);

      if (selectedId === deletingRole.id) {
        handleDetailClose();
      }
    } catch (deleteError) {
      toast.error(
        deleteError instanceof Error
          ? deleteError.message
          : "Failed to delete role",
      );
    }
  }

  async function handleSavePermissions(
    permissions: Parameters<
      typeof updatePermissionsMutation.mutateAsync
    >[0]["permissions"],
  ) {
    if (!permissionsRole || isSavingPermissions) return;

    try {
      await updatePermissionsMutation.mutateAsync({
        id: permissionsRole.id,
        permissions,
      });
      toast.success("Permissions updated successfully");
      setPermissionsOpen(false);
      setPermissionsRole(null);
    } catch (saveError) {
      toast.error(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save permissions",
      );
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <ShieldCheckIcon className="h-6 w-6 text-pink-600" />
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              Role & Permission
            </h1>
            <p className="text-sm text-gray-500">
              IAM roles and menu access ({allRows.length} roles)
            </p>
          </div>
        </div>
        <Button
          type="button"
          onClick={handleOpenAdd}
          className="gap-2 bg-pink-600 text-white hover:bg-pink-700"
        >
          <PlusIcon className="h-4 w-4" />
          Add Role
        </Button>
      </div>

      <Card className="border-gray-200/70">
        <CardContent className="px-4 pt-4">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Input
              placeholder="Search name, code, or description..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
            <Select
              value={statusFilter || "all"}
              onValueChange={(value) =>
                setStatusFilter(value === "all" ? "" : value)
              }
            >
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-pink-500" />
            </div>
          ) : isError ? (
            <div className="py-12 text-center">
              <p className="mb-1 text-sm font-medium text-gray-700">
                Failed to load roles
              </p>
              <p className="mb-3 text-xs text-gray-500">
                {error instanceof Error
                  ? error.message
                  : "A server error occurred"}
              </p>
              <button
                type="button"
                onClick={() => refetch()}
                className="rounded-lg border border-pink-200 px-3 py-1.5 text-sm font-medium text-pink-700 hover:bg-pink-50"
              >
                Try again
              </button>
            </div>
          ) : allRows.length === 0 ? (
            <div className="py-12 text-center text-gray-400">
              No roles found
            </div>
          ) : (
            <RolesTable
              rows={allRows}
              selectedId={selectedId}
              onView={handleView}
              onEdit={handleOpenEdit}
              onDelete={handleOpenDelete}
              onManagePermissions={handleOpenPermissions}
            />
          )}
        </CardContent>
      </Card>

      <Dialog
        open={detailOpen}
        onOpenChange={(open) => !open && handleDetailClose()}
      >
        <DialogPanel size="md">
          <DialogPanelHeader>
            <DialogPanelTitle>
              {detailData?.name ?? "Role Details"}
            </DialogPanelTitle>
            <DialogPanelDescription>
              {detailData?.code
                ? `Code: ${detailData.code} — permissions & metadata`
                : "IAM role information and menu permissions"}
            </DialogPanelDescription>
          </DialogPanelHeader>

          <DialogPanelBody>
            {detailLoading ? (
              <div className="flex justify-center py-12">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-pink-500" />
              </div>
            ) : detailError ? (
              <p className="text-sm text-gray-500">
                Failed to load role details
              </p>
            ) : detailData ? (
              <RoleDetailSections detail={detailData} />
            ) : null}
          </DialogPanelBody>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleDetailClose}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>

      <RoleFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        mode={formMode}
        roleId={formRoleId}
        role={editingRole}
        isSubmitting={isFormSubmitting}
        onSubmit={handleFormSubmit}
      />

      <RolePermissionsDialog
        open={permissionsOpen}
        onOpenChange={(open) => {
          if (!open && !isSavingPermissions) {
            setPermissionsOpen(false);
            setPermissionsRole(null);
          }
        }}
        role={permissionsRole}
        isSubmitting={isSavingPermissions}
        onSubmit={handleSavePermissions}
      />

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!open && !isDeleting) {
            setDeleteOpen(false);
            setDeletingRole(null);
          }
        }}
      >
        <DialogPanel size="xs">
          <DialogPanelHeader>
            <DialogPanelTitle>Delete Role?</DialogPanelTitle>
            <DialogPanelDescription>
              Are you sure you want to delete &quot;{deletingRole?.name}&quot;?
              The role will be deactivated and removed from the list.
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={isDeleting}
            >
              {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>
    </div>
  );
}

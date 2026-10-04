"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelForm,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useRoleDetail } from "../queries";
import type { CreateRolePayload, RoleItem } from "../types";
import { generateRoleCode } from "../utils/role-code";

export interface RoleFormValues {
  code: string;
  name: string;
  description: string;
  isActive: boolean;
}

function defaultFormValues(): RoleFormValues {
  return {
    code: "",
    name: "",
    description: "",
    isActive: true,
  };
}

interface RoleFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  roleId: string | null;
  role?: RoleItem | null;
  isSubmitting: boolean;
  onSubmit: (payload: CreateRolePayload) => Promise<void>;
}

export function RoleFormDialog({
  open,
  onOpenChange,
  mode,
  roleId,
  role,
  isSubmitting,
  onSubmit,
}: RoleFormDialogProps) {
  const { data: detail, isLoading: detailLoading } = useRoleDetail(
    mode === "edit" && roleId ? roleId : null,
  );
  const waitingForDetail = mode === "edit" && (detailLoading || !detail);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPanel size="sm">
        {!open ? null : waitingForDetail ? (
          <DialogPanelBody className="flex justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-pink-500" />
          </DialogPanelBody>
        ) : (
          // Form dipasang ulang tiap dialog dibuka supaya mulai dari nilai awal.
          <RoleForm
            key={mode === "edit" ? `edit-${roleId}` : "create"}
            mode={mode}
            initial={
              detail && mode === "edit"
                ? {
                    code: detail.code,
                    name: detail.name,
                    description: detail.description ?? "",
                    isActive: detail.isActive,
                  }
                : defaultFormValues()
            }
            isSystem={role?.isSystem ?? detail?.isSystem ?? false}
            isSubmitting={isSubmitting}
            onSubmit={onSubmit}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogPanel>
    </Dialog>
  );
}

function RoleForm({
  mode,
  initial,
  isSystem,
  isSubmitting,
  onSubmit,
  onCancel,
}: {
  mode: "create" | "edit";
  initial: RoleFormValues;
  isSystem: boolean;
  isSubmitting: boolean;
  onSubmit: (payload: CreateRolePayload) => Promise<void>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<RoleFormValues>(initial);
  // Kode role baru ikut nama sampai user mengetik kodenya sendiri.
  const [codeTouched, setCodeTouched] = useState(mode === "edit");

  const autoCode = useMemo(
    () => (values.name.trim() ? generateRoleCode(values.name) : ""),
    [values.name],
  );

  const displayCode = codeTouched || mode === "edit" ? values.code : autoCode;

  function handleNameChange(name: string) {
    setValues((prev) => ({
      ...prev,
      name,
      code: codeTouched || mode === "edit" ? prev.code : generateRoleCode(name),
    }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (isSubmitting) return;

    const code = (
      codeTouched || mode === "edit" ? values.code : autoCode
    ).trim();
    const name = values.name.trim();

    if (!code || !name) return;

    await onSubmit({
      code,
      name,
      description: values.description.trim() || undefined,
      isActive: values.isActive,
    });
  }

  return (
    <DialogPanelForm onSubmit={handleSubmit}>
      <DialogPanelHeader>
        <DialogPanelTitle>
          {mode === "create" ? "Add Role" : "Edit Role"}
        </DialogPanelTitle>
        <DialogPanelDescription>
          {mode === "create"
            ? "Create a custom IAM role with menu permissions."
            : "Update role metadata and status."}
        </DialogPanelDescription>
      </DialogPanelHeader>

      <DialogPanelBody className="space-y-4">
        <>
          <div className="space-y-2">
            <Label htmlFor="role-name">Role Name</Label>
            <Input
              id="role-name"
              value={values.name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="e.g. Finance Manager"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="role-code">Code</Label>
            <Input
              id="role-code"
              value={displayCode}
              onChange={(e) => {
                setCodeTouched(true);
                setValues((prev) => ({
                  ...prev,
                  code: e.target.value.toLowerCase().replace(/\s+/g, "_"),
                }));
              }}
              placeholder="e.g. finance_manager"
              readOnly={isSystem}
              className={
                isSystem ? "bg-gray-50 font-mono text-sm" : "font-mono text-sm"
              }
              required
            />
            {isSystem ? (
              <p className="text-xs text-gray-500">
                System role codes cannot be changed.
              </p>
            ) : (
              <p className="text-xs text-gray-500">
                Auto-generated from name. Lowercase letters, numbers, and
                underscores only.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="role-description">Description</Label>
            <Textarea
              id="role-description"
              value={values.description}
              onChange={(e) =>
                setValues((prev) => ({
                  ...prev,
                  description: e.target.value,
                }))
              }
              placeholder="Optional description for this role"
              rows={3}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-gray-200/70 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-gray-900">Active</p>
              <p className="text-xs text-gray-500">
                Inactive roles cannot be assigned.
              </p>
            </div>
            <Switch
              checked={values.isActive}
              onCheckedChange={(checked) =>
                setValues((prev) => ({ ...prev, isActive: checked }))
              }
            />
          </div>
        </>
      </DialogPanelBody>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          className="bg-pink-600 text-white hover:bg-pink-700"
          disabled={isSubmitting}
        >
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {mode === "create" ? "Add Role" : "Save Changes"}
        </Button>
      </DialogFooter>
    </DialogPanelForm>
  );
}

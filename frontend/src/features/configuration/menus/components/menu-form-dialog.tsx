"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useMenuDetail } from "../queries";
import type { CreateMenuPayload, MenuItem } from "@/lib/iam/menu-types";
import { generateMenuCode } from "../utils/menu-code";
import {
  buildParentOptions,
  defaultFormValues,
  effectiveModule,
  toFormValues,
  toPayload,
  type MenuFormValues,
} from "../menu-form";
import { FormSection, IconSelect } from "./menu-form-fields";
import { PermissionActionPicker } from "./permission-action-picker";

const MENU_TYPE_OPTIONS = [
  {
    value: "sidebar",
    label: "Sidebar",
    description: "Navigation link shown in the sidebar.",
  },
  {
    value: "group",
    label: "Group",
    description: "Expandable module folder with child menus.",
  },
] as const;

interface MenuFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  menuId?: string | null;
  defaultParentId?: string | null;
  menus: MenuItem[];
  isSubmitting: boolean;
  onSubmit: (payload: CreateMenuPayload) => void;
}

export function MenuFormDialog({
  open,
  onOpenChange,
  mode,
  menuId,
  defaultParentId,
  menus,
  isSubmitting,
  onSubmit,
}: MenuFormDialogProps) {
  const { data: detailData, isLoading: detailLoading } = useMenuDetail(
    mode === "edit" && open && menuId ? menuId : null,
  );
  const initial =
    mode === "edit"
      ? detailData
        ? toFormValues(detailData)
        : null
      : defaultFormValues(defaultParentId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPanel
        size="md"
        style={{ "--dialog-panel-max-height": "92vh" } as CSSProperties}
      >
        <DialogPanelHeader>
          <DialogPanelTitle>
            {mode === "edit" ? "Edit Menu" : "Add Menu"}
          </DialogPanelTitle>
          <DialogPanelDescription>
            {mode === "edit"
              ? "Update IAM sidebar menu configuration"
              : "Add a new menu to the sidebar hierarchy"}
          </DialogPanelDescription>
        </DialogPanelHeader>

        {mode === "edit" && detailLoading ? (
          <DialogPanelBody className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-pink-600" />
          </DialogPanelBody>
        ) : open && initial ? (
          // Form dipasang ulang tiap dialog dibuka supaya mulai dari nilai awal.
          <MenuForm
            key={
              mode === "edit"
                ? `edit-${menuId}`
                : `create-${defaultParentId ?? "root"}`
            }
            initial={initial}
            mode={mode}
            menuId={menuId}
            menus={menus}
            isSubmitting={isSubmitting}
            onSubmit={onSubmit}
            onCancel={() => onOpenChange(false)}
          />
        ) : null}
      </DialogPanel>
    </Dialog>
  );
}

function MenuForm({
  initial,
  mode,
  menuId,
  menus,
  isSubmitting,
  onSubmit,
  onCancel,
}: {
  initial: MenuFormValues;
  mode: "create" | "edit";
  menuId?: string | null;
  menus: MenuItem[];
  isSubmitting: boolean;
  onSubmit: (payload: CreateMenuPayload) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<MenuFormValues>(initial);
  const moduleValue =
    mode === "create" ? effectiveModule(form, menus) : form.module;

  const parentOptions = useMemo(
    () => buildParentOptions(menus, mode === "edit" ? menuId : null),
    [menus, mode, menuId],
  );

  const parentComboboxOptions = useMemo((): ComboboxOption[] => {
    const menuById = new Map(menus.map((menu) => [menu.id, menu]));
    const items: ComboboxOption[] = [
      {
        value: "root",
        label: "Root (no parent)",
        description: "Top-level menu",
      },
      ...parentOptions.map((option) => {
        const menu = menuById.get(option.id);
        return {
          value: option.id,
          label: option.label.trim() || menu?.menuName || option.id,
          description: menu?.code,
        };
      }),
    ];

    if (form.parentId && !items.some((item) => item.value === form.parentId)) {
      const parent = menus.find((menu) => menu.id === form.parentId);
      if (parent) {
        items.push({
          value: parent.id,
          label:
            `${parent.level > 0 ? "— ".repeat(parent.level) : ""}${parent.menuName}`.trim(),
          description: parent.code,
        });
      }
    }

    return items;
  }, [parentOptions, form.parentId, menus]);

  const existingCodes = useMemo(
    () => new Set(menus.map((menu) => menu.code)),
    [menus],
  );

  const generatedCode = useMemo(() => {
    if (mode === "edit") return form.code;

    return generateMenuCode({
      menuName: form.menuName,
      module: moduleValue,
      routePath: form.routePath,
      parentId: form.parentId,
      menus,
      existingCodes,
    });
  }, [
    mode,
    form.code,
    form.menuName,
    moduleValue,
    form.routePath,
    form.parentId,
    menus,
    existingCodes,
  ]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (isSubmitting) return;

    if (!form.menuName.trim()) return;

    const payload = toPayload({
      ...form,
      module: moduleValue,
      code: mode === "create" ? generatedCode : form.code,
    });

    onSubmit(payload);
  }

  const displayCode = mode === "create" ? generatedCode : form.code;

  return (
    <DialogPanelForm onSubmit={handleSubmit}>
      <DialogPanelBody className="space-y-4 bg-gray-50/40">
        <FormSection
          title="Basic Information"
          description="Menu code is generated automatically by the system."
        >
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="menu-parent">Parent Menu</Label>
              <Combobox
                options={parentComboboxOptions}
                value={form.parentId ?? "root"}
                onChange={(value) =>
                  setForm((prev) => ({
                    ...prev,
                    parentId: !value || value === "root" ? null : value,
                  }))
                }
                placeholder="Root (no parent)"
                searchPlaceholder="Search parent menu..."
                emptyMessage="No parent menu found."
                className="h-9 bg-white"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Code</Label>
              <div className="rounded-lg border border-gray-200/70 bg-gray-50/80 px-3 py-2.5">
                <p className="font-mono text-sm text-gray-900">
                  {displayCode || "—"}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {mode === "create"
                    ? "Auto-generated from parent, module, route, and menu name."
                    : "System code cannot be changed after creation."}
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="menu-name">
                  Menu Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="menu-name"
                  value={form.menuName}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, menuName: e.target.value }))
                  }
                  placeholder="Menu Management"
                  required
                  className="h-9 bg-white text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="menu-type">Menu Type</Label>
                <Select
                  value={form.menuType}
                  onValueChange={(value) =>
                    setForm((prev) => ({
                      ...prev,
                      menuType: value as MenuFormValues["menuType"],
                    }))
                  }
                >
                  <SelectTrigger id="menu-type" className="h-9 bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MENU_TYPE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-500">
                  {
                    MENU_TYPE_OPTIONS.find(
                      (option) => option.value === form.menuType,
                    )?.description
                  }
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="menu-order">Order</Label>
                <Input
                  id="menu-order"
                  type="number"
                  min={0}
                  value={form.orderNumber}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      orderNumber: Number(e.target.value) || 0,
                    }))
                  }
                  className="h-9 bg-white text-sm"
                />
              </div>
            </div>
          </div>
        </FormSection>

        <FormSection title="Route & Module">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="menu-route">URL Path</Label>
              <Input
                id="menu-route"
                value={form.routePath}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, routePath: e.target.value }))
                }
                placeholder="/dashboard/settings/menus"
                className="h-9 bg-white font-mono text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="menu-module">Module</Label>
              <Input
                id="menu-module"
                value={moduleValue}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, module: e.target.value }))
                }
                placeholder="settings"
                className="h-9 bg-white text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="menu-icon">Icon</Label>
              <IconSelect
                value={form.icon}
                onChange={(icon) => setForm((prev) => ({ ...prev, icon }))}
              />
            </div>
          </div>
        </FormSection>

        <FormSection
          title="Permission Actions"
          description="Pick suggested actions or add custom ones such as approval, import, or reconcile."
        >
          <PermissionActionPicker
            value={form.permissionActions}
            onChange={(permissionActions) =>
              setForm((prev) => ({ ...prev, permissionActions }))
            }
          />
        </FormSection>

        <FormSection title="Description">
          <Textarea
            id="menu-description"
            value={form.description}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, description: e.target.value }))
            }
            placeholder="Optional description for this menu..."
            rows={3}
            className="min-h-20 resize-none border-gray-200/70 bg-white text-sm focus-visible:ring-1 focus-visible:ring-gray-200"
          />
        </FormSection>

        <FormSection title="Status">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200/70 bg-white px-3 py-2.5">
              <Label htmlFor="menu-active" className="text-sm">
                Active
              </Label>
              <Switch
                id="menu-active"
                checked={form.isActive}
                onCheckedChange={(checked) =>
                  setForm((prev) => ({ ...prev, isActive: checked }))
                }
              />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200/70 bg-white px-3 py-2.5">
              <Label htmlFor="menu-visible" className="text-sm">
                Visible
              </Label>
              <Switch
                id="menu-visible"
                checked={form.isVisible}
                onCheckedChange={(checked) =>
                  setForm((prev) => ({ ...prev, isVisible: checked }))
                }
              />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200/70 bg-white px-3 py-2.5">
              <Label htmlFor="menu-new-tab" className="text-sm">
                New Tab
              </Label>
              <Switch
                id="menu-new-tab"
                checked={form.openInNewTab}
                onCheckedChange={(checked) =>
                  setForm((prev) => ({ ...prev, openInNewTab: checked }))
                }
              />
            </div>
          </div>
        </FormSection>
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
          disabled={isSubmitting || !form.menuName.trim()}
          className="bg-pink-600 text-white hover:bg-pink-700"
        >
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isSubmitting ? "Saving..." : "Save"}
        </Button>
      </DialogFooter>
    </DialogPanelForm>
  );
}

"use client";

import { useMemo } from "react";
import { AppSidebarNavIcon } from "@/components/shared/app-sidebar-nav-icons";
import { Combobox } from "@/components/ui/combobox";
import type { NavIconName } from "@/lib/iam/types";
import { MENU_ICON_OPTIONS } from "../constants/menu-icons";

export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-xl border border-gray-200/70 bg-white p-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {description ? (
          <p className="mt-0.5 text-xs text-gray-500">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function IconSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (icon: string) => void;
}) {
  const iconOptions = useMemo(
    () =>
      MENU_ICON_OPTIONS.map((icon) => ({
        value: icon,
        label: icon,
      })),
    [],
  );

  const selectedIcon = MENU_ICON_OPTIONS.includes(value as NavIconName)
    ? (value as NavIconName)
    : "clipboard";

  return (
    <div className="space-y-2">
      <Combobox
        options={iconOptions}
        value={value || "clipboard"}
        onChange={onChange}
        placeholder="Select icon..."
        searchPlaceholder="Search icons..."
        emptyMessage="No icon found."
        className="h-9"
      />
      <div className="flex items-center gap-2 rounded-lg border border-gray-200/70 bg-gray-50/60 px-3 py-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-gray-600 shadow-sm">
          <AppSidebarNavIcon
            name={selectedIcon}
            className="h-4 w-4"
            isActive={false}
          />
        </span>
        <span className="font-mono text-xs text-gray-600">{selectedIcon}</span>
      </div>
    </div>
  );
}

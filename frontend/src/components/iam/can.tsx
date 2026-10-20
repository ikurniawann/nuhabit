"use client";

import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCan } from "./iam-access-provider";

const ACTION_LABEL: Record<string, string> = {
  read: "melihat",
  create: "menambah",
  update: "mengubah",
  delete: "menghapus",
  read_own: "melihat data sendiri",
};

/** Teks tooltip tombol yang dikunci: "Butuh izin mengubah". */
export function permissionHint(action: string): string {
  return `Butuh izin ${ACTION_LABEL[action] ?? action}`;
}

/**
 * Tampilkan aksi hanya bila user punya izinnya (aturan guard API Go).
 * mode "hide" membuang aksinya; "disable" tetap menampilkannya, terkunci,
 * dengan tooltip "Butuh izin …".
 */
export function Can({
  menu,
  action,
  mode = "hide",
  children,
}: {
  menu: string | readonly string[];
  action: string;
  mode?: "hide" | "disable";
  children: ReactNode;
}) {
  const allowed = useCan(menu, action);
  if (allowed) return <>{children}</>;
  if (mode === "hide") return null;
  const hint = permissionHint(action);
  return (
    <Tooltip>
      <TooltipTrigger render={<span tabIndex={0} className="inline-flex flex-wrap gap-2 cursor-not-allowed" />}>
        {/* A disabled fieldset disables every button inside it. */}
        <fieldset disabled className="contents">
          {children}
        </fieldset>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}

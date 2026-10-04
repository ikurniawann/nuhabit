"use client";

import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  loadingLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  /** danger = red confirm (delete/deactivate), default = pink confirm. */
  variant?: "danger" | "default";
  /** Optional extra content rendered in the body. */
  children?: ReactNode;
}

/**
 * Standardized confirmation modal built on the DialogPanel design system.
 * Use for delete / activate / deactivate and other yes-no confirmations.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Konfirmasi",
  cancelLabel = "Batal",
  loadingLabel = "Memproses...",
  loading = false,
  onConfirm,
  variant = "danger",
  children,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPanel size="xs">
        <DialogPanelHeader>
          <DialogPanelTitle>{title}</DialogPanelTitle>
          {description ? (
            <DialogPanelDescription>{description}</DialogPanelDescription>
          ) : null}
        </DialogPanelHeader>
        <DialogPanelBody>{children}</DialogPanelBody>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
            className="h-10 rounded-lg border-gray-200/80"
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              "h-10 gap-2 rounded-lg px-4 text-sm font-semibold text-white shadow-sm",
              variant === "danger"
                ? "bg-red-600 hover:bg-red-700"
                : "bg-pink-600 hover:bg-pink-700"
            )}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {loading ? loadingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}

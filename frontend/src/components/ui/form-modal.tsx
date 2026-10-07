"use client";

import type { FormEvent, ReactNode } from "react";
import type { VariantProps } from "class-variance-authority";
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
  dialogPanelVariants,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type PanelSize = VariantProps<typeof dialogPanelVariants>["size"];

export interface FormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Panel width — xs (420px), sm (lg), md (2xl), lg (3xl), xl (4xl). Default sm. */
  size?: PanelSize;
  onSubmit: (e: FormEvent) => void;
  submitLabel?: string;
  cancelLabel?: string;
  loadingLabel?: string;
  loading?: boolean;
  submitDisabled?: boolean;
  /** Extra classes for the scrollable body (fields container). */
  bodyClassName?: string;
  children: ReactNode;
}

/**
 * Standardized add/edit form modal built on the DialogPanel design system.
 * Header + scrollable body + sticky footer (Cancel / Save).
 */
export function FormModal({
  open,
  onOpenChange,
  title,
  description,
  size = "sm",
  onSubmit,
  submitLabel = "Save",
  cancelLabel = "Cancel",
  loadingLabel = "Saving...",
  loading = false,
  submitDisabled = false,
  bodyClassName,
  children,
}: FormModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPanel size={size}>
        <DialogPanelForm onSubmit={onSubmit}>
          <DialogPanelHeader>
            <DialogPanelTitle>{title}</DialogPanelTitle>
            {description ? (
              <DialogPanelDescription>{description}</DialogPanelDescription>
            ) : null}
          </DialogPanelHeader>
          <DialogPanelBody className={cn("space-y-4", bodyClassName)}>
            {children}
          </DialogPanelBody>
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
              type="submit"
              disabled={loading || submitDisabled}
              className="h-10 gap-2 rounded-lg bg-pink-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-pink-700"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {loading ? loadingLabel : submitLabel}
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}

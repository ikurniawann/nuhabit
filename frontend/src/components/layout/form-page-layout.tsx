"use client";

import type { ReactNode } from "react";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** Full-width page shell for create/edit forms (no centered max-width column). */
export function FormPageLayout({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("w-full space-y-6", className)}>{children}</div>;
}

export function FormPageHeader({
  title,
  description,
  onBack,
  backLabel = "Kembali",
  actions,
  className,
}: {
  title: string;
  description?: string;
  onBack?: () => void;
  backLabel?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex w-full flex-col gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center sm:justify-between",
        className
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {onBack ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="shrink-0 text-gray-600"
          >
            <ArrowLeftIcon className="mr-1.5 h-4 w-4" />
            {backLabel}
          </Button>
        ) : null}
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
          {description ? <p className="mt-1 text-sm text-gray-500">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Main form content — spans full content width. */
export function FormPageBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("w-full space-y-6", className)}>{children}</div>;
}

/** Sticky-style footer actions aligned to the right, full width. */
export function FormPageFooter({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex w-full flex-wrap items-center justify-end gap-3 border-t border-gray-200/70 pt-4",
        className
      )}
    >
      {children}
    </div>
  );
}

export function FormPageLoading({ className }: { className?: string }) {
  return (
    <div className={cn("flex w-full justify-center py-20", className)}>
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-gray-300 border-t-pink-500" />
    </div>
  );
}

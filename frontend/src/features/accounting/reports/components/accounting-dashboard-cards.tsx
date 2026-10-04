"use client";

import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRightIcon,
  CheckCircleIcon,
  ClipboardDocumentListIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { cn } from "@/lib/utils";
import { formatLedgerAmount } from "@/lib/accounting/format";

export function KpiCard({
  label,
  value,
  hint,
  href,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: number;
  hint?: string;
  href?: string;
  icon: ComponentType<{ className?: string }>;
  tone?: "default" | "positive" | "negative" | "warning";
}) {
  const toneClass =
    tone === "positive"
      ? "bg-emerald-50 text-emerald-600"
      : tone === "negative"
        ? "bg-red-50 text-red-600"
        : tone === "warning"
          ? "bg-amber-50 text-amber-600"
          : "bg-primary/10 text-brand-text";

  const inner = (
    <div className="group relative overflow-hidden rounded-xl border border-gray-200/70 bg-card p-4 shadow-sm transition-all hover:border-primary/20 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="mt-2 truncate text-xl font-bold tabular-nums text-foreground sm:text-2xl">
            {formatLedgerAmount(value)}
          </p>
          {hint ? (
            <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>
          ) : null}
        </div>
        <span
          className={cn(
            "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
            toneClass,
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
      </div>
      {href ? (
        <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand-text opacity-0 transition-opacity group-hover:opacity-100">
          Lihat detail <ArrowRightIcon className="h-3 w-3" />
        </span>
      ) : null}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block">
        {inner}
      </Link>
    );
  }
  return inner;
}

export function StatChip({
  label,
  value,
  ok,
}: {
  label: string;
  value: ReactNode;
  ok?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-gray-200/70 bg-card px-4 py-3 shadow-sm">
      <span
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-lg",
          ok === true
            ? "bg-emerald-50 text-emerald-600"
            : ok === false
              ? "bg-amber-50 text-amber-600"
              : "bg-muted text-muted-foreground",
        )}
      >
        {ok === true ? (
          <CheckCircleIcon className="h-4 w-4" />
        ) : ok === false ? (
          <ExclamationTriangleIcon className="h-4 w-4" />
        ) : (
          <ClipboardDocumentListIcon className="h-4 w-4" />
        )}
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="truncate text-sm font-semibold tabular-nums text-foreground">
          {value}
        </p>
      </div>
    </div>
  );
}

export function Panel({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border border-gray-200/70 bg-card shadow-sm",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3 border-b border-gray-200/70 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground sm:text-base">
            {title}
          </h2>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {action}
      </div>
      <div className="p-3 sm:p-4">{children}</div>
    </section>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="animate-pulse space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-28 rounded-xl border border-gray-200/70 bg-muted/40"
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-16 rounded-xl border border-gray-200/70 bg-muted/40"
          />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-90 rounded-xl border border-gray-200/70 bg-muted/40" />
        <div className="h-90 rounded-xl border border-gray-200/70 bg-muted/40" />
      </div>
    </div>
  );
}

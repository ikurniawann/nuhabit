"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { ComponentType } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { cn } from "@/lib/utils";
import { REPORT_ROUTES } from "../routes";

export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function yearStartStr() {
  return `${todayStr().slice(0, 4)}-01-01`;
}

export function ReportShell({
  icon,
  title,
  description,
  toolbar,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <Link
          href={REPORT_ROUTES.hub}
          className={cn(
            buttonVariants({ variant: "outline" }),
            "h-10 rounded-lg border-gray-200/80",
          )}
        >
          Dashboard
        </Link>
      </div>
      <PurchasingListSection
        icon={icon}
        title={title}
        description="Akun tanpa mutasi tetap tampil dengan saldo 0."
        toolbar={toolbar}
      >
        {children}
      </PurchasingListSection>
    </div>
  );
}

export function AsOfFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Input
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 w-37.5 bg-card text-sm focus:border-primary/40 focus:ring-1 focus:ring-primary/30"
      aria-label="Per tanggal"
    />
  );
}

export function PeriodFilter({
  dateFrom,
  dateTo,
  onFrom,
  onTo,
}: {
  dateFrom: string;
  dateTo: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        type="date"
        value={dateFrom}
        onChange={(e) => onFrom(e.target.value)}
        className="h-10 w-37.5 bg-card text-sm focus:border-primary/40 focus:ring-1 focus:ring-primary/30"
        aria-label="Dari"
      />
      <Input
        type="date"
        value={dateTo}
        onChange={(e) => onTo(e.target.value)}
        className="h-10 w-37.5 bg-card text-sm focus:border-primary/40 focus:ring-1 focus:ring-primary/30"
        aria-label="Sampai"
      />
    </div>
  );
}

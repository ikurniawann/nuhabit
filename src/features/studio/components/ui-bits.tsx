"use client";

import type { ReactNode, SelectHTMLAttributes } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/** Header halaman Studio — judul Outfit + subjudul muted + aksi di kanan (DESIGN.md §10). */
export function StudioPageHeader({ title, subtitle, actions }: { title: string; subtitle: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-[13px] font-semibold text-foreground">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

/** Select native bertoken (lebih andal untuk value=id daripada select headless). */
export function NativeSelect({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-9 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 disabled:opacity-60",
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
}

const TONE = {
  positive: "bg-nh-lettuce/30 text-nh-forest",
  warning: "bg-nh-ochre/20 text-nh-forest",
  danger: "bg-destructive/10 text-destructive",
  neutral: "bg-muted text-muted-foreground",
  brand: "bg-nh-forest text-nh-lime",
} as const;

/** Badge status (DESIGN.md §8). */
export function Pill({ tone = "neutral", children, className }: { tone?: keyof typeof TONE; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", TONE[tone], className)}>
      {children}
    </span>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
      <p className="font-display text-lg font-semibold text-foreground">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/**
 * Link bergaya tombol. Tidak memakai `buttonVariants` karena deklarasi ambient
 * lama di src/types/ui.d.ts menimpa tipe ekspor Button.
 */
export function LinkButton({ href, variant = "default", children }: { href: string; variant?: "default" | "outline"; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border px-2.5 text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-4 [&_svg]:shrink-0",
        variant === "outline"
          ? "border-primary/30 bg-background text-primary hover:bg-primary/5"
          : "border-transparent bg-primary text-primary-foreground hover:bg-primary/85"
      )}
    >
      {children}
    </Link>
  );
}

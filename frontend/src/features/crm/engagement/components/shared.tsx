"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Label + kontrol + petunjuk, untuk form engagement. */
export function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn("flex min-w-0 flex-col", className)}>
      <span className="mb-1.5 text-sm font-medium text-foreground">{label}</span>
      {children}
      {hint && <span className="mt-1 text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

/** Baris kosong / galat di dalam kartu tabel. */
export function TableNote({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "danger" }) {
  return (
    <p
      className={cn(
        "px-5 py-10 text-center text-sm",
        tone === "danger" ? "text-danger" : "text-muted-foreground"
      )}
    >
      {children}
    </p>
  );
}

export const TEXTAREA =
  "min-h-24 w-full rounded-2xl border border-border bg-card px-4 py-3 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-forest focus-visible:ring-2 focus-visible:ring-forest/20 md:text-sm";

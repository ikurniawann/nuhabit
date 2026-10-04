import * as React from "react"

import { cn } from "@/lib/utils"

export function Kicker({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      className={cn(
        "text-[11px] font-semibold tracking-wider text-muted-foreground uppercase",
        className
      )}
      {...props}
    />
  )
}

/** The page's h1 with a one-sentence purpose and its actions (they wrap on phones). */
export function PageHeader({
  title,
  description,
  kicker,
  actions,
  className,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  kicker?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("mb-6 flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-[min(16rem,100%)] flex-1">
        {kicker && <Kicker className="mb-1">{kicker}</Kicker>}
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

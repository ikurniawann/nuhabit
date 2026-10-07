import * as React from "react"
import Link from "next/link"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/** One tone union for tiles, stat cards and status maps. */
export type Tone = "default" | "danger" | "success" | "warning" | "info" | "ink" | "accent"

const iconTileVariants = cva("flex shrink-0 items-center justify-center [&_svg]:shrink-0", {
  variants: {
    tone: {
      default: "bg-surface text-body",
      danger: "bg-danger-soft text-danger",
      success: "bg-success-soft text-success",
      warning: "bg-warning-soft text-warning",
      info: "bg-info-soft text-info",
      ink: "bg-ink text-on-ink",
      accent: "bg-accent text-accent-foreground",
    },
    size: {
      sm: "size-9 rounded-xl [&_svg]:size-4",
      md: "size-[42px] rounded-[13px] [&_svg]:size-[18px]",
      lg: "size-12 rounded-2xl [&_svg]:size-5",
    },
  },
  defaultVariants: { tone: "default", size: "md" },
})

export function IconTile({
  tone,
  size,
  className,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof iconTileVariants>) {
  return <div aria-hidden className={cn(iconTileVariants({ tone, size }), className)} {...props} />
}

/**
 * Label, value with a muted unit, a hint and a tinted tile. Pass `href` to make
 * the whole card a link (the tile then opens its list or filter).
 */
export function StatCard({
  label,
  value,
  unit,
  hint,
  icon,
  tone = "default",
  href,
  className,
}: {
  label: React.ReactNode
  value: React.ReactNode
  unit?: React.ReactNode
  hint?: React.ReactNode
  icon?: React.ReactNode
  tone?: Tone
  href?: string
  className?: string
}) {
  const body = (
    <div className="flex w-full items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-body/80">{label}</div>
        <div className="mt-1.5 flex items-start gap-1">
          <span className="truncate text-[28px] leading-[1.15] font-extrabold tracking-[-0.5px] text-foreground tabular-nums">
            {value}
          </span>
          {unit && (
            <span className="shrink-0 pt-1.5 text-sm font-semibold text-muted-foreground">{unit}</span>
          )}
        </div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </div>
      {icon && <IconTile tone={tone}>{icon}</IconTile>}
    </div>
  )
  const shell = cn(
    "flex flex-col rounded-card bg-card p-5 text-left shadow-card print:break-inside-avoid",
    href &&
      "w-full transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-forest/40 focus-visible:outline-none active:scale-[0.98]",
    className
  )
  if (href) {
    return (
      <Link href={href} className={shell}>
        {body}
      </Link>
    )
  }
  return <div className={shell}>{body}</div>
}

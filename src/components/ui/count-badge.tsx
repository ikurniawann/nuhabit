import { cn } from "@/lib/utils"

/** Nav and tab counter: renders nothing at 0 and caps at 99+. */
export function CountBadge({
  count,
  tone = "accent",
  className,
}: {
  count: number
  tone?: "accent" | "white"
  className?: string
}) {
  if (!count) return null
  return (
    <span
      className={cn(
        "inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1 text-[10px] leading-none font-bold tabular-nums ring-2",
        tone === "accent"
          ? "bg-accent-strong text-accent-foreground ring-card"
          : "bg-white text-ink ring-ink",
        className
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  )
}

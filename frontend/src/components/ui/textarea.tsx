import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-20 w-full rounded-2xl border border-border bg-card px-4 py-3 text-base text-foreground transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-forest focus-visible:ring-2 focus-visible:ring-forest/20 disabled:cursor-not-allowed disabled:bg-surface disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }

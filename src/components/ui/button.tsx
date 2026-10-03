import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full border border-transparent bg-clip-padding text-sm font-semibold whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-forest/40 active:not-aria-[haspopup]:scale-[0.98] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-accent-strong text-accent-foreground shadow-glow hover:bg-accent-dark",
        primary: "bg-accent-strong text-accent-foreground shadow-glow hover:bg-accent-dark",
        ink: "bg-ink text-on-ink hover:bg-ink-3",
        outline:
          "border-border bg-card text-foreground hover:bg-surface aria-expanded:bg-surface",
        secondary:
          "bg-surface text-foreground hover:bg-surface-2 aria-expanded:bg-surface-2",
        soft: "bg-surface text-foreground hover:bg-surface-2",
        card: "bg-card text-foreground shadow-card hover:bg-surface",
        ghost:
          "text-foreground hover:bg-muted aria-expanded:bg-muted",
        onInk: "bg-white/10 text-white hover:bg-white/20",
        destructive:
          "bg-danger-soft text-danger hover:bg-danger hover:text-white dark:hover:text-ink focus-visible:ring-danger/30",
        link: "text-forest underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 gap-2 px-4",
        xs: "h-7 gap-1 px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-3 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-12 gap-2 px-6 text-base",
        icon: "size-10",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }

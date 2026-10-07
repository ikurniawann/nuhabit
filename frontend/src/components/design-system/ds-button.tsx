"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type DsButtonSize = "xs" | "md" | "lg";

const sizeMap: Record<DsButtonSize, NonNullable<React.ComponentProps<typeof Button>["size"]>> = {
  xs: "xs",
  md: "default",
  lg: "lg",
};

export interface DsButtonProps extends Omit<React.ComponentProps<typeof Button>, "size"> {
  size?: DsButtonSize;
  loading?: boolean;
}

export function DsButton({
  size = "md",
  loading = false,
  disabled,
  children,
  className,
  ...props
}: DsButtonProps) {
  return (
    <Button
      size={sizeMap[size]}
      disabled={disabled || loading}
      className={cn(className)}
      {...props}
    >
      {loading ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
      {children}
    </Button>
  );
}

export { buttonVariants };

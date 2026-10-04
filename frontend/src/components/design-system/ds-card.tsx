import * as React from "react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { dsCardSurface } from "./tokens";

export type DsCardPadding = "none" | "sm" | "md";

const contentPadding: Record<DsCardPadding, string> = {
  none: "px-0",
  sm: "px-3",
  md: "px-4",
};

export interface DsCardProps extends React.ComponentProps<typeof Card> {
  padding?: DsCardPadding;
  flush?: boolean;
}

export function DsCard({ className, flush, ...props }: DsCardProps) {
  return (
    <Card
      className={cn(dsCardSurface, flush && "gap-0 py-0", className)}
      {...props}
    />
  );
}

export function DsCardHeader({ className, ...props }: React.ComponentProps<typeof CardHeader>) {
  return (
    <CardHeader
      className={cn("border-b border-gray-200/70 px-4 py-4", className)}
      {...props}
    />
  );
}

export function DsCardTitle({ className, ...props }: React.ComponentProps<typeof CardTitle>) {
  return <CardTitle className={cn("text-base font-semibold text-gray-900", className)} {...props} />;
}

export function DsCardDescription({ className, ...props }: React.ComponentProps<typeof CardDescription>) {
  return <CardDescription className={cn("text-xs text-gray-500", className)} {...props} />;
}

export function DsCardAction(props: React.ComponentProps<typeof CardAction>) {
  return <CardAction {...props} />;
}

export function DsCardContent({
  className,
  padding = "md",
  ...props
}: React.ComponentProps<typeof CardContent> & { padding?: DsCardPadding }) {
  return <CardContent className={cn(contentPadding[padding], className)} {...props} />;
}

export function DsCardFooter({ className, ...props }: React.ComponentProps<typeof CardFooter>) {
  return (
    <CardFooter
      className={cn("border-t border-gray-200/70 bg-gray-50/50 px-4 py-3", className)}
      {...props}
    />
  );
}

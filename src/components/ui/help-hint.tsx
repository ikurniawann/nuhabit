"use client";

import { Info } from "lucide-react";
import { getHelpText, type HelpRole } from "@/lib/help/help-content";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

export function HelpHint({
  helpId,
  role = "default",
  className,
}: {
  helpId: string;
  role?: HelpRole;
  className?: string;
}) {
  const text = getHelpText(helpId, role);
  if (!text) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label="Bantuan"
            className={cn(
              "inline-flex size-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-brand-text",
              className
            )}
          />
        }
      >
        <Info className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}

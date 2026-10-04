import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const formInputClassName =
  "h-10 bg-white text-sm focus:border-pink-400 focus:ring-2 focus:ring-pink-100";

export const formSelectTriggerClassName =
  "h-10 bg-white text-sm focus:border-pink-400 focus:ring-2 focus:ring-pink-100";

export const formComboboxClassName =
  "!w-full h-10 bg-white text-sm focus-visible:border-pink-400 focus-visible:ring-2 focus-visible:ring-pink-100";

export const filterComboboxClassName = "!w-full h-9 bg-white text-sm";

export function FormFieldLabel({
  children,
  required,
  htmlFor,
  className,
}: {
  children: ReactNode;
  required?: boolean;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn("mb-1.5 block text-xs font-medium text-gray-600", className)}
    >
      {children}
      {required ? <span className="ml-0.5 text-red-500">*</span> : null}
    </label>
  );
}

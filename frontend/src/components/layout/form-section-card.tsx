import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface FormSectionCardProps {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function FormSectionCard({
  icon: Icon,
  title,
  description,
  children,
  className,
  bodyClassName,
}: FormSectionCardProps) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm",
        className
      )}
    >
      <div className="border-b border-gray-100 px-5 py-4">
        <div className="flex items-center gap-3">
          {Icon ? (
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-pink-50 text-pink-600">
              <Icon className="h-5 w-5" />
            </span>
          ) : null}
          <div>
            <h2 className="text-base font-semibold text-gray-950">{title}</h2>
            {description ? <p className="text-xs text-gray-500">{description}</p> : null}
          </div>
        </div>
      </div>
      <div className={cn("px-5 py-5", bodyClassName)}>{children}</div>
    </section>
  );
}

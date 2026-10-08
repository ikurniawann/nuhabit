import type { ReactNode } from "react";

const CONTROL_BASE =
  "flex h-10 w-full rounded-md border bg-transparent py-2 text-sm outline-none transition-colors focus:border-[#00281a] disabled:cursor-not-allowed disabled:opacity-50";

/** Input and select classes for the careers form; `withIcon` leaves room for an icon on the left. */
export function controlClass(hasError = false, withIcon = false) {
  return `${CONTROL_BASE} ${withIcon ? "pl-9" : "px-3"} ${hasError ? "border-[#00281a]" : "border-[#e3dbcc]"}`;
}

interface FormFieldProps {
  id?: string;
  label: string;
  required?: boolean;
  error?: string;
  children: ReactNode;
}

export function FormField({ id, label, required, error, children }: FormFieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-xs font-bold uppercase tracking-[0.12em] text-[#2a332e]">
        {label} {required && <span className="text-[#00281a]">*</span>}
      </label>
      {children}
      {error && <p className="text-xs text-[#00281a]">{error}</p>}
    </div>
  );
}

export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-[#e3dbcc] bg-mint p-5 sm:p-6">
      <h2 className="mb-4 text-base font-medium leading-tight">{title}</h2>
      {children}
    </div>
  );
}

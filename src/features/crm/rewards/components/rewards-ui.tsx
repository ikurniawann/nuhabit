import type { ComponentType, ReactNode } from "react";

/** Primitif tampilan halaman Rewards. */

type IconType = ComponentType<{ className?: string }>;

export const selectClass =
  "h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100";

export function TabButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: IconType;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition ${
        active ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"
      }`}
    >
      <Icon className="size-4" />
      {children}
    </button>
  );
}

const TONES = {
  default: "border-slate-300 bg-white text-slate-700 hover:bg-slate-100",
  danger: "border-red-200 bg-white text-red-700 hover:bg-red-50",
  primary: "border-slate-950 bg-slate-950 text-white hover:bg-slate-800",
};

export function IconButton({
  onClick,
  icon: Icon,
  children,
  disabled,
  tone = "default",
}: {
  onClick: () => void;
  icon: IconType;
  children: ReactNode;
  disabled?: boolean;
  tone?: keyof typeof TONES;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-md border px-3 text-xs font-medium transition disabled:opacity-50 ${TONES[tone]}`}
    >
      <Icon className="size-3.5" />
      {children}
    </button>
  );
}

export function MetricCard({ icon: Icon, label, value }: { icon: IconType; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex size-10 items-center justify-center rounded-md bg-slate-100 text-slate-700">
        <Icon className="size-5" />
      </div>
      <div className="text-2xl font-semibold text-slate-950">{value}</div>
      <div className="mt-1 text-sm text-slate-500">{label}</div>
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  hint?: string;
}) {
  return (
    <label className="space-y-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={selectClass}
      />
      {hint && <span className="block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="space-y-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className={selectClass}>
        {children}
      </select>
    </label>
  );
}

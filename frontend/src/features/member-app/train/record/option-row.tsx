import type { ReactNode } from "react";
import type { Timer } from "lucide-react";

export function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`h-7 w-12 shrink-0 rounded-full p-1 transition ${on ? "bg-nh-forest" : "bg-nh-line"}`}
    >
      <span
        className={`block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : ""}`}
      />
    </button>
  );
}

export function OptionRow({
  icon: Icon,
  label,
  hint,
  right,
  onClick,
}: {
  icon: typeof Timer;
  label: string;
  hint?: string;
  right: ReactNode;
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className="flex w-full items-center gap-3 px-2 py-3 text-left active:bg-nh-raised"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-nh-ink-soft text-white">
        <Icon size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm leading-tight font-bold">{label}</span>
        {hint ? (
          <span className="block truncate text-xs text-nh-muted">{hint}</span>
        ) : null}
      </span>
      {right}
    </Tag>
  );
}

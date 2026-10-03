"use client";

import type { ReactNode } from "react";
import { useT } from "./mobile-i18n";

/** Label kecil berhuruf kapital + aksi opsional di kanan. */
export function SectionHeader({ label, action }: { label: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between px-1">
      <h2 className="text-[11px] font-extrabold tracking-[0.16em] text-nh-muted uppercase">{label}</h2>
      {action}
    </div>
  );
}

export function SeeAll({ onClick }: { onClick: () => void }) {
  const t = useT();
  return (
    <button type="button" onClick={onClick} className="text-xs font-bold text-nh-ink/50">
      {t("Semua →")}
    </button>
  );
}

export function ScreenTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div>
      <h1 className="nh-display text-3xl font-black">{children}</h1>
      {hint && <p className="mt-1 text-sm text-nh-muted">{hint}</p>}
    </div>
  );
}

export function EmptyCard({ children }: { children: ReactNode }) {
  return <p className="nh-card text-sm text-nh-muted">{children}</p>;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl bg-nh-danger/10 px-4 py-3 text-sm text-nh-danger">{children}</p>;
}

export function OkNote({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="rounded-2xl bg-nh-lime-soft px-4 py-3 text-sm font-semibold text-nh-forest">
      {children}
    </p>
  );
}

export function LoadingNote({ children }: { children?: ReactNode }) {
  const t = useT();
  return <p className="py-6 text-center text-sm text-nh-muted">{children ?? t("Memuat…")}</p>;
}

/** Saklar aksesibel (role="switch") bergaya portal. */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
        checked ? "bg-nh-forest" : "bg-nh-ink/20"
      }`}
    >
      <span
        className={`absolute top-1 left-1 size-5 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-5" : ""
        }`}
      />
    </button>
  );
}

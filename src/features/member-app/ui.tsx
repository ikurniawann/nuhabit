"use client";

import type { ReactNode } from "react";
import { Loader2, X } from "lucide-react";

export function Spinner({ className = "" }: { className?: string }) {
  return <Loader2 className={`size-6 animate-spin text-nh-lime ${className}`} />;
}

export function CenterSpinner() {
  return (
    <div className="flex justify-center py-16">
      <Spinner />
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <h2 className="font-display text-lg font-semibold text-nh-beige">{children}</h2>
      {action}
    </div>
  );
}

export function PillButton({
  children,
  onClick,
  disabled,
  variant = "lime",
  className = "",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "lime" | "ghost" | "danger";
  className?: string;
  type?: "button" | "submit";
}) {
  const tone =
    variant === "lime"
      ? "bg-nh-lime text-nh-forest hover:brightness-95"
      : variant === "danger"
        ? "border border-red-300/40 text-red-200 hover:bg-red-400/10"
        : "border border-white/15 text-nh-beige hover:bg-white/5";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold transition disabled:opacity-50 ${tone} ${className}`}
    >
      {children}
    </button>
  );
}

export function Card({ children, className = "", onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  const base = `rounded-3xl border border-white/10 bg-nh-jungle p-4 ${className}`;
  return onClick ? (
    <button type="button" onClick={onClick} className={`${base} w-full text-left transition hover:border-nh-lime/40`}>
      {children}
    </button>
  ) : (
    <div className={base}>{children}</div>
  );
}

export function Tag({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "lime" | "warn" | "danger" }) {
  const cls =
    tone === "lime"
      ? "bg-nh-lime text-nh-forest"
      : tone === "warn"
        ? "bg-nh-ochre/25 text-nh-lemon"
        : tone === "danger"
          ? "bg-red-400/15 text-red-200"
          : "bg-white/10 text-nh-beige/80";
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${cls}`}>{children}</span>;
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-dashed border-white/15 px-6 py-10 text-center">
      <p className="font-display text-base font-semibold text-nh-beige">{title}</p>
      {hint && <p className="mt-1 text-sm text-nh-beige/60">{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Lembar bawah (bottom sheet) untuk konfirmasi & detail. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-t-[2rem] border-t border-white/10 bg-nh-ink px-5 pb-8 pt-4 text-nh-beige"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="font-display text-xl font-semibold">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-nh-beige/60 hover:bg-white/10">
            <X className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Avatar({ name, photo, size = 48 }: { name: string; photo?: string | null; size?: number }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return photo ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={photo} alt={name} width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-nh-everglade font-display font-semibold text-nh-lime"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials}
    </span>
  );
}

export function Notice({ tone, children }: { tone: "ok" | "error"; children: ReactNode }) {
  return (
    <div className={`rounded-2xl px-4 py-3 text-sm ${tone === "ok" ? "bg-nh-lime/15 text-nh-lemon" : "bg-red-400/15 text-red-200"}`}>{children}</div>
  );
}

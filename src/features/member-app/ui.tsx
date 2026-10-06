"use client";

import { type ReactNode, useEffect, useState } from "react";
import { ArrowDownRight, Loader2, Minus, Plus, X } from "lucide-react";

/**
 * Primitif UI Member App — bahasa visual editorial (referensi The Yard Gym,
 * keputusan owner 2026-10-06): kanvas hitam, sudut tajam, garis tipis,
 * judul UPPERCASE rapat, panel geser dari kanan. Identitas NüHabit tetap:
 * logo, beige sebagai "krem", lime sebagai aksen aksi utama.
 */

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

/** Label kecil uppercase berjarak (eyebrow). */
export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`text-[11px] font-semibold uppercase tracking-[0.14em] text-nh-beige/55 ${className}`}>{children}</p>;
}

/** Judul halaman besar uppercase. */
export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="pt-6">
      <h1 className="font-display text-[2.6rem] font-bold uppercase leading-[0.92] tracking-[-0.02em] text-white">{children}</h1>
      {sub && <p className="mt-3 text-xs font-medium uppercase leading-relaxed tracking-wide text-nh-beige/70">{sub}</p>}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <h2 className="font-display text-2xl font-bold uppercase leading-none tracking-[-0.01em] text-white">{children}</h2>
      {action}
    </div>
  );
}

/** Tautan aksi kecil uppercase (mis. "See all"). */
export function TextAction({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-[11px] font-semibold uppercase tracking-[0.14em] text-nh-lime underline-offset-4 hover:underline">
      {children}
    </button>
  );
}

type ButtonVariant = "lime" | "light" | "ghost" | "danger";

/**
 * Tombol kotak uppercase. lime = aksi utama, light = beige (seperti "Start a
 * trial"), ghost = kotak bergaris, danger = batal/hapus. `arrow` menambah ↘ di
 * pojok kanan bawah (gaya tombol navigasi referensi).
 */
export function PillButton({
  children,
  onClick,
  disabled,
  variant = "lime",
  className = "",
  type = "button",
  arrow = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: ButtonVariant;
  className?: string;
  type?: "button" | "submit";
  arrow?: boolean;
}) {
  const tone =
    variant === "lime"
      ? "bg-nh-lime text-black hover:bg-nh-lime/90"
      : variant === "light"
        ? "bg-nh-beige text-black hover:bg-white"
        : variant === "danger"
          ? "border border-red-300/50 text-red-200 hover:bg-red-400/10"
          : "border border-white/25 bg-white/[0.03] text-white hover:bg-white/[0.08]";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`relative inline-flex min-h-12 items-center justify-center gap-2 px-5 py-3.5 text-xs font-bold uppercase tracking-[0.12em] transition disabled:opacity-45 ${tone} ${className}`}
    >
      {children}
      {arrow && <ArrowDownRight className="absolute bottom-1.5 right-1.5 size-3.5 opacity-70" />}
    </button>
  );
}

export function Card({ children, className = "", onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  const base = `border border-white/12 bg-white/[0.035] p-4 ${className}`;
  return onClick ? (
    <button type="button" onClick={onClick} className={`${base} w-full text-left transition hover:border-white/35`}>
      {children}
    </button>
  ) : (
    <div className={base}>{children}</div>
  );
}

/** Chip bergaris membulat (seperti "PAY DAY · GAME DAY" di referensi). */
export function Tag({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "lime" | "warn" | "danger" | "light" }) {
  const cls =
    tone === "lime"
      ? "border-nh-lime bg-nh-lime text-black"
      : tone === "light"
        ? "border-nh-beige bg-nh-beige text-black"
        : tone === "warn"
          ? "border-nh-ochre/70 text-nh-lemon"
          : tone === "danger"
            ? "border-red-300/60 text-red-200"
            : "border-white/35 text-nh-beige/85";
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] ${cls}`}>{children}</span>;
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="border border-dashed border-white/20 px-6 py-10 text-center">
      <p className="font-display text-lg font-bold uppercase tracking-tight text-white">{title}</p>
      {hint && <p className="mt-1 text-sm text-nh-beige/60">{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Panel geser dari kanan, layar penuh di HP (pola slide-over referensi). */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="nh-fade-in fixed inset-0 z-50 bg-black/75" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="nh-slide-in absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-white/15 bg-black text-nh-beige"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/12 px-5 pb-5 pt-6">
          <h3 className="font-display text-3xl font-bold uppercase leading-[0.95] tracking-[-0.02em] text-white">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-1 mt-1 p-1 text-white hover:text-nh-lime">
            <X className="size-6" strokeWidth={1.5} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-10 pt-5">{children}</div>
      </div>
    </div>
  );
}

/** Foto kotak (hitam-putih bila ada foto) atau inisial. */
export function Avatar({ name, photo, size = 48, mono = true }: { name: string; photo?: string | null; size?: number; mono?: boolean }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return photo ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={photo} alt={name} width={size} height={size} className={`shrink-0 object-cover ${mono ? "grayscale" : ""}`} style={{ width: size, height: size }} />
  ) : (
    <span
      className="inline-flex shrink-0 items-center justify-center bg-nh-everglade font-display font-bold text-nh-lime"
      style={{ width: size, height: size, fontSize: size * 0.34 }}
    >
      {initials}
    </span>
  );
}

export function Notice({ tone, children }: { tone: "ok" | "error"; children: ReactNode }) {
  return (
    <div className={`border-l-2 px-4 py-3 text-sm ${tone === "ok" ? "border-nh-lime bg-nh-lime/10 text-nh-lemon" : "border-red-300 bg-red-400/10 text-red-200"}`}>{children}</div>
  );
}

/** Accordion bernomor dengan garis tipis ("01. FACILITIES + AMENITIES  +"). */
export function Accordion({ index, title, children, defaultOpen = false }: { index?: number; title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-white/15">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center justify-between gap-4 py-4 text-left">
        <span className="text-sm font-bold uppercase tracking-[0.04em] text-white">
          {index !== undefined && `${String(index).padStart(2, "0")}. `}
          {title}
        </span>
        {open ? <Minus className="size-5 shrink-0 text-white" strokeWidth={1.5} /> : <Plus className="size-5 shrink-0 text-white" strokeWidth={1.5} />}
      </button>
      {open && <div className="pb-5">{children}</div>}
    </div>
  );
}

/** Label vertikal di tepi blok (seperti tab "THE TRAINING" di referensi). */
export function SideLabel({ children, tone = "light" }: { children: string; tone?: "light" | "lime" }) {
  return (
    <div className={`flex w-9 shrink-0 items-end justify-center pb-3 ${tone === "lime" ? "bg-nh-lime text-black" : "bg-nh-beige text-black"}`}>
      <span className="whitespace-nowrap font-display text-lg font-bold uppercase leading-none tracking-tight [writing-mode:vertical-rl] rotate-180">{children}</span>
    </div>
  );
}

/** Wordmark raksasa berjalan di kaki halaman. */
export function MarqueeWordmark() {
  const word = "NÜHABIT ";
  return (
    <div className="overflow-hidden border-t border-white/10 py-4" aria-hidden>
      <div className="nh-marquee flex w-max whitespace-nowrap font-display text-[5.5rem] font-bold uppercase leading-none tracking-[-0.03em] text-white">
        <span>{word.repeat(6)}</span>
        <span>{word.repeat(6)}</span>
      </div>
    </div>
  );
}

"use client";

import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useT } from "../lib/i18n";

/** Kembali + judul layar + petunjuk opsional, pola layar akun aplikasi member. */
export function PageTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  const t = useT();
  const router = useRouter();
  return (
    <>
      <button onClick={() => router.back()} className="flex items-center gap-1 text-sm font-bold text-nh-muted">
        <ArrowLeft size={16} /> {t("Back")}
      </button>
      <div>
        <h1 className="nh-display text-3xl font-black">{children}</h1>
        {hint ? <p className="mt-1 text-sm text-nh-muted">{hint}</p> : null}
      </div>
    </>
  );
}

export function SectionHeader({ label, action }: { label: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between px-1">
      <p className="text-[11px] font-extrabold tracking-[0.16em] text-nh-muted uppercase">{label}</p>
      {action}
    </div>
  );
}

/** Pesan hasil aksi: hijau-lime bila berhasil, merah bila gagal. */
export function Notice({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <p
      role="status"
      className={`rounded-2xl px-4 py-3 text-sm font-semibold ${
        ok ? "bg-nh-lime-soft text-nh-forest" : "bg-nh-danger/10 text-nh-danger"
      }`}
    >
      {children}
    </p>
  );
}

export function ProgressBar({ pct, label }: { pct: number; label?: string }) {
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={label}
      className="h-2.5 overflow-hidden rounded-full bg-nh-raised"
    >
      <span className="nh-surface-brand block h-full rounded-full" style={{ width: `${pct}%` }} />
    </div>
  );
}

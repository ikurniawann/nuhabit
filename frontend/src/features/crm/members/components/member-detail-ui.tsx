import type { ComponentType, ReactNode } from "react";

/** Primitif tampilan halaman detail member. */

type IconType = ComponentType<{ className?: string }>;

export type Feedback = { error: string | null; success: string | null };

export const NO_FEEDBACK: Feedback = { error: null, success: null };

export function errorText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export function FeedbackNote({ feedback, className = "" }: { feedback: Feedback; className?: string }) {
  return (
    <>
      {feedback.error && (
        <div className={`rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 ${className}`}>
          {feedback.error}
        </div>
      )}
      {feedback.success && (
        <div className={`rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 ${className}`}>
          {feedback.success}
        </div>
      )}
    </>
  );
}

export function EmptyBox({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}

/** Kartu daftar riwayat: judul + jumlah di header, isi atau pesan kosong. */
export function HistoryCard({
  icon: Icon,
  title,
  countLabel,
  empty,
  children,
}: {
  icon: IconType;
  title: string;
  countLabel: string;
  /** Teks saat daftar kosong; null = ada isi. */
  empty: string | null;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h3 className="flex items-center gap-2 text-base font-semibold text-slate-950">
          <Icon className="size-4" />
          {title}
        </h3>
        <span className="text-xs text-slate-500">{countLabel}</span>
      </div>
      <div className="p-4">
        {empty !== null ? (
          <EmptyBox>{empty}</EmptyBox>
        ) : (
          <div className="divide-y divide-slate-100 overflow-hidden rounded-md border border-slate-200">{children}</div>
        )}
      </div>
    </div>
  );
}

export function DetailMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-slate-950">{value}</div>
    </div>
  );
}

export function StatusLine({ icon: Icon, label, value }: { icon: IconType; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-2">
      <Icon className="size-4 text-slate-400" />
      <div className="min-w-0">
        <div className="text-xs text-slate-500">{label}</div>
        <div className="truncate text-sm font-medium text-slate-800">{value}</div>
      </div>
    </div>
  );
}

export const fieldClass =
  "mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100 disabled:bg-slate-100 disabled:text-slate-400";

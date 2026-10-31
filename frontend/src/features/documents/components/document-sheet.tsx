"use client";

import type { ComponentProps, ReactNode } from "react";
import Image from "next/image";
import { Input } from "@/components/ui/input";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { cn } from "@/lib/utils";
import type { Letterhead } from "../api";

/**
 * Kertas dokumen (quotation, invoice) yang diisi langsung di tempat. Lembar
 * memakai `.theme-light` agar tetap putih seperti kertas di mode gelap, jadi
 * isinya hanya memakai token semantik (bukan kelas gray-*, yang dipetakan
 * ulang oleh tema gelap dashboard).
 */
export function DocumentSheet({ className, ...props }: ComponentProps<"article">) {
  return (
    <article
      className={cn(
        "theme-light mx-auto w-full max-w-[1100px] overflow-hidden rounded-2xl bg-card text-foreground shadow-card ring-1 ring-border",
        className,
      )}
      {...props}
    />
  );
}

/** Panel filter lembut di atas kertas (pelanggan, cabang, tarik dari ...). */
export function DocumentFilterStrip({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "mx-auto mb-4 grid w-full max-w-[1100px] grid-cols-1 gap-3 rounded-2xl bg-surface-2 p-4 sm:grid-cols-3",
        className,
      )}
      {...props}
    />
  );
}

/** Kop: logo di kiri; nama legal, alamat, email dan NPWP rata kanan. */
export function DocumentLetterhead({
  letterhead,
  branchName,
}: {
  letterhead: Letterhead | undefined;
  branchName?: string | null;
}) {
  if (!letterhead) {
    return <div className="h-28 animate-pulse bg-surface-2" aria-hidden="true" />;
  }
  const address = [letterhead.address, letterhead.city].filter(Boolean).join(", ");
  return (
    <header className="flex flex-col gap-4 px-5 pt-6 pb-5 sm:flex-row sm:items-start sm:justify-between sm:px-8">
      <Image
        src={letterhead.logo_url}
        alt={`Logo ${letterhead.legal_name}`}
        width={180}
        height={56}
        unoptimized
        className="h-14 w-auto max-w-[180px] object-contain object-left"
      />
      <div className="space-y-0.5 text-xs text-muted-foreground sm:text-right">
        <p className="font-display text-lg font-bold text-foreground">{letterhead.legal_name}</p>
        {branchName ? <p>{branchName}</p> : null}
        {address ? <p>{address}</p> : null}
        {letterhead.email ? (
          <p>
            <a href={`mailto:${letterhead.email}`} className="text-info underline underline-offset-2">
              {letterhead.email}
            </a>
          </p>
        ) : null}
        {letterhead.phone ? <p>Telp. {letterhead.phone}</p> : null}
        {letterhead.npwp ? <p>NPWP: {letterhead.npwp}</p> : null}
      </div>
    </header>
  );
}

/** Pita judul selebar kertas: "QUOTATION" lalu "Nomor : ...". */
export function DocumentTitleBand({
  title,
  number,
  placeholder,
}: {
  title: string;
  number: string | null | undefined;
  /** Teks pengganti nomor sebelum dokumen bernomor. */
  placeholder: string;
}) {
  return (
    <div className="border-y border-border bg-surface-2 px-5 py-3 text-center sm:px-8">
      <h2 className="font-display text-xl font-bold tracking-[0.2em] text-forest">{title}</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">
        Nomor :{" "}
        {number ? (
          <span className="font-semibold text-foreground">{number}</span>
        ) : (
          <span className="italic">{placeholder}</span>
        )}
      </p>
    </div>
  );
}

/** Dua kolom info dengan garis pemisah; bertumpuk di ponsel. */
export function DocumentInfoGrid({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-y-2.5 px-5 py-5 sm:px-8 md:grid-cols-2 md:divide-x md:divide-border">
      <div className="space-y-2.5 md:pr-6">{left}</div>
      <div className="space-y-2.5 md:pl-6">{right}</div>
    </div>
  );
}

/** Tanda wajib merah; inputnya sendiri membawa `required` untuk pembaca layar. */
export function RequiredMark() {
  return (
    <span className="text-danger" aria-hidden="true">
      {" "}
      *
    </span>
  );
}

/**
 * Satu baris "LABEL : isian". `htmlFor` menautkan label ke inputnya; tanpa
 * `htmlFor` barisnya hanya-baca.
 */
export function DocumentInfoRow({
  label,
  htmlFor,
  required,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  children: ReactNode;
}) {
  const labelClass = "pt-2 text-[11px] font-medium uppercase italic tracking-wide text-muted-foreground";
  const content = (
    <>
      {label}
      {required ? <RequiredMark /> : null}
    </>
  );
  return (
    <div className="grid grid-cols-[6.5rem_auto_minmax(0,1fr)] items-start gap-x-2 sm:grid-cols-[8.5rem_auto_minmax(0,1fr)]">
      {htmlFor ? (
        <label htmlFor={htmlFor} className={labelClass}>
          {content}
        </label>
      ) : (
        <span className={labelClass}>{content}</span>
      )}
      <span className="pt-2 text-muted-foreground" aria-hidden="true">
        :
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Gaya isian bergaris bawah, dipakai juga untuk Combobox dan NumericInput. */
export const documentLineClass =
  "h-9 w-full rounded-none border-x-0 border-t-0 border-b border-border bg-transparent px-1 text-sm shadow-none focus-visible:border-forest focus-visible:ring-0";

export function DocumentLineInput({ className, ...props }: ComponentProps<typeof Input>) {
  return <Input {...props} className={cn(documentLineClass, className)} />;
}

/** Nilai hanya-baca dengan garis isian yang sama. */
export function DocumentLineText({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <p className={cn("min-h-9 border-b border-border px-1 py-2 text-sm text-foreground", className)}>
      {children || "—"}
    </p>
  );
}

export interface DocumentColumn {
  label: string;
  className?: string;
  /** Judul kolom hanya untuk pembaca layar (mis. kolom aksi). */
  srOnly?: boolean;
  required?: boolean;
}

/** Tabel item di atas kertas; menggulir mendatar di layar sempit. */
export function DocumentItemsTable({
  label,
  columns,
  children,
}: {
  label: string;
  columns: DocumentColumn[];
  children: ReactNode;
}) {
  return (
    <ScrollRegion label={label} axis="x" className="overflow-x-auto px-5 sm:px-8">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            {columns.map((column) => (
              <th key={column.label} scope="col" className={cn("px-2 py-2 font-semibold", column.className)}>
                {column.srOnly ? <span className="sr-only">{column.label}</span> : column.label}
                {column.required ? <RequiredMark /> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </ScrollRegion>
  );
}

const SUMMARY_TONES = {
  plain: "bg-surface-2 text-foreground",
  discount: "bg-warning-soft text-warning",
  tax: "bg-info-soft text-info",
  total: "bg-lime text-forest text-base font-bold",
} as const;

/** Kotak ringkasan: baris bertumpuk membulat (subtotal, diskon, PPN, total). */
export function DocumentSummary({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="space-y-1.5">
      {children}
    </section>
  );
}

export function DocumentSummaryRow({
  label,
  value,
  tone = "plain",
  children,
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: keyof typeof SUMMARY_TONES;
  /** Kontrol di samping label, mis. persen diskon atau saklar PPN. */
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl px-4 py-2.5 text-sm",
        SUMMARY_TONES[tone],
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="font-semibold uppercase tracking-wide">{label}</span>
        {children}
      </div>
      <span className="ml-auto tabular-nums font-semibold">{value}</span>
    </div>
  );
}

/**
 * Bilah aksi lengket di bawah halaman, di atas bilah navigasi ponsel. Di
 * dalam sheet (`inSheet`) bilah navigasi tertutup overlay, jadi bilah
 * menempel ke dasar.
 */
export function DocumentFooterBar({
  children,
  hint,
  inSheet,
}: {
  children: ReactNode;
  hint?: ReactNode;
  inSheet?: boolean;
}) {
  return (
    <div
      className={cn(
        "sticky z-20 mt-6 bg-card/95 px-4 py-3 backdrop-blur",
        inSheet
          ? "bottom-0 ring-1 ring-border"
          : "bottom-22 rounded-2xl shadow-float md:bottom-0 md:rounded-none md:shadow-none md:ring-1 md:ring-border",
      )}
    >
      <div className="mx-auto flex w-full max-w-[1100px] flex-wrap items-center justify-end gap-2">
        {hint ? <p className="mr-auto text-xs text-warning">{hint}</p> : null}
        {children}
      </div>
    </div>
  );
}

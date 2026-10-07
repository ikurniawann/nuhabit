"use client";

import { useMemo, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useBulkUpdateDates } from "../queries";
import type { ProductDateKind, TicketProductDetail } from "../types";

// Flow owner: kalender per bulan → ceklis 1/multiple tanggal → Simpan →
// tanggal tertanda High Season atau Blok Online.

const MONTH_NAMES = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
const DAY_NAMES = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

const KIND_META: Record<
  ProductDateKind,
  { label: string; hint: string; markClass: string; pendingClass: string }
> = {
  "high-season": {
    label: "High Season",
    hint: "Harga High Season berlaku di tanggal tertanda",
    markClass: "bg-amber-500 text-white",
    pendingClass: "ring-2 ring-amber-500 bg-amber-100 text-amber-800",
  },
  "blok-online": {
    label: "Blok Online",
    hint: "Tanggal tertanda tidak dijual di website booking — walk-in tetap jalan",
    markClass: "bg-red-500 text-white",
    pendingClass: "ring-2 ring-red-500 bg-red-100 text-red-800",
  },
};

const toIso = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Semua tanggal ISO dalam [start, end] (inklusif) — utk expand rentang lama. */
function expandRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const [sy, sm, sd] = start.split("-").map(Number);
  const cursor = new Date(Date.UTC(sy, sm - 1, sd));
  const [ey, em, ed] = end.split("-").map(Number);
  const last = Date.UTC(ey, em - 1, ed);
  while (cursor.getTime() <= last && dates.length < 400) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function CalendarTab({ detail }: { detail: TicketProductDetail }) {
  const now = new Date();
  const [kind, setKind] = useState<ProductDateKind>("high-season");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-index
  // Perubahan belum tersimpan: date → true (ceklis) / false (unceklis)
  const [pending, setPending] = useState<Map<string, boolean>>(new Map());

  const saveMutation = useBulkUpdateDates(() => setPending(new Map()));

  // Tanggal tertanda per kind dari server (rentang lama di-expand harian)
  const savedMarks = useMemo(() => {
    const marks: Record<ProductDateKind, Set<string>> = {
      "high-season": new Set(),
      "blok-online": new Set(),
    };
    for (const range of detail.dates) {
      if (!range.is_active) continue;
      for (const date of expandRange(range.start_date, range.end_date)) {
        marks[range.date_kind].add(date);
      }
    }
    return marks;
  }, [detail.dates]);

  const isMarked = (date: string, k: ProductDateKind) => {
    const override = k === kind ? pending.get(date) : undefined;
    return override ?? savedMarks[k].has(date);
  };

  const toggleDate = (date: string) => {
    setPending((prev) => {
      const next = new Map(prev);
      const current = next.get(date) ?? savedMarks[kind].has(date);
      const target = !current;
      // Kembali ke keadaan tersimpan → hapus dari pending
      if (target === savedMarks[kind].has(date)) next.delete(date);
      else next.set(date, target);
      return next;
    });
  };

  const changeMonth = (delta: number) => {
    const next = new Date(year, month + delta, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth());
  };

  const switchKind = (nextKind: ProductDateKind) => {
    if (nextKind === kind) return;
    if (pending.size > 0) {
      // Jangan buang ceklis diam-diam saat ganti mode
      const ok = window.confirm(
        "Ada ceklis belum disimpan — buang perubahan dan ganti mode?"
      );
      if (!ok) return;
    }
    setPending(new Map());
    setKind(nextKind);
  };

  // Grid bulan: Senin sebagai kolom pertama
  const cells = useMemo(() => {
    const firstDay = new Date(year, month, 1).getDay(); // 0=Min
    const leading = (firstDay + 6) % 7; // geser: Senin=0
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const result: (number | null)[] = [];
    for (let i = 0; i < leading; i++) result.push(null);
    for (let d = 1; d <= daysInMonth; d++) result.push(d);
    return result;
  }, [year, month]);

  const meta = KIND_META[kind];
  const addList = [...pending.entries()].filter(([, v]) => v).map(([d]) => d);
  const removeList = [...pending.entries()].filter(([, v]) => !v).map(([d]) => d);

  const handleSave = () => {
    if (pending.size === 0 || saveMutation.isPending) return;
    saveMutation.mutate({
      id: detail.product.id,
      values: { date_kind: kind, add: addList, remove: removeList },
    });
  };

  return (
    <div className="max-w-2xl space-y-4">
      {/* Mode penandaan */}
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(KIND_META) as ProductDateKind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => switchKind(k)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
              kind === k
                ? k === "high-season"
                  ? "border-amber-500 bg-amber-50 text-amber-800"
                  : "border-red-500 bg-red-50 text-red-700"
                : "border-gray-200 text-gray-500 hover:bg-gray-50"
            )}
          >
            {KIND_META[k].label}
          </button>
        ))}
        <p className="w-full text-xs text-gray-500 sm:ml-2 sm:w-auto">
          {meta.hint}
        </p>
      </div>

      {/* Navigasi bulan */}
      <div className="flex items-center justify-between rounded-t-xl border border-gray-200/70 bg-gray-50/80 px-3 py-2">
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          onClick={() => changeMonth(-1)}
        >
          <ChevronLeftIcon className="h-4 w-4" />
        </Button>
        <p className="text-sm font-semibold text-gray-900">
          {MONTH_NAMES[month]} {year}
        </p>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          onClick={() => changeMonth(1)}
        >
          <ChevronRightIcon className="h-4 w-4" />
        </Button>
      </div>

      {/* Grid kalender */}
      <div className="-mt-4 rounded-b-xl border border-t-0 border-gray-200/70 p-3">
        <div className="grid grid-cols-7 gap-1">
          {DAY_NAMES.map((day) => (
            <div
              key={day}
              className="py-1 text-center text-xs font-semibold uppercase tracking-wide text-gray-400"
            >
              {day}
            </div>
          ))}
          {cells.map((day, index) => {
            if (day === null) return <div key={`empty-${index}`} />;
            const iso = toIso(year, month, day);
            const activeMarked = isMarked(iso, kind);
            const isPending = pending.has(iso);
            const otherKind: ProductDateKind =
              kind === "high-season" ? "blok-online" : "high-season";
            const otherMarked = isMarked(iso, otherKind);

            return (
              <button
                key={iso}
                type="button"
                onClick={() => toggleDate(iso)}
                className={cn(
                  "relative flex h-11 flex-col items-center justify-center rounded-lg border text-sm transition-colors",
                  activeMarked
                    ? isPending
                      ? meta.pendingClass + " border-transparent"
                      : meta.markClass + " border-transparent"
                    : isPending
                      ? "border-gray-300 bg-gray-100 text-gray-500 line-through"
                      : "border-gray-200/70 text-gray-700 hover:bg-gray-50"
                )}
              >
                {day}
                {/* titik penanda kind satunya, biar dua-duanya kelihatan */}
                {otherMarked ? (
                  <span
                    className={cn(
                      "absolute bottom-1 h-1.5 w-1.5 rounded-full",
                      otherKind === "high-season" ? "bg-amber-500" : "bg-red-500"
                    )}
                  />
                ) : null}
              </button>
            );
          })}
        </div>

        {/* Legend */}
        <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-gray-200/70 pt-3 text-xs text-gray-600">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded bg-amber-500" /> High Season
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded bg-red-500" /> Blok Online
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded bg-gray-100 ring-1 ring-gray-300" />{" "}
            Ceklis belum disimpan
          </span>
        </div>
      </div>

      {/* Aksi simpan */}
      <div className="flex items-center gap-2">
        <Button
          onClick={handleSave}
          disabled={pending.size === 0 || saveMutation.isPending}
        >
          {saveMutation.isPending
            ? "Menyimpan…"
            : pending.size === 0
              ? "Simpan"
              : `Simpan (${addList.length ? `+${addList.length}` : ""}${
                  addList.length && removeList.length ? ", " : ""
                }${removeList.length ? `−${removeList.length}` : ""} tanggal)`}
        </Button>
        {pending.size > 0 ? (
          <Button
            variant="outline"
            onClick={() => setPending(new Map())}
            disabled={saveMutation.isPending}
          >
            Batal
          </Button>
        ) : null}
      </div>
    </div>
  );
}

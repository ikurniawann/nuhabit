"use client";

// EPIC-031 Fase C1 — kalender okupansi bulanan di dashboard Booking:
// (booking + walk-in) / kapasitas per tanggal, warna per tingkat isi,
// klik tanggal → filter daftar booking di bawahnya. Angka boleh tampil
// di sini (dashboard internal) — beda dari kalender publik.

import { useMemo, useState } from "react";
import { CalendarDaysIcon } from "@heroicons/react/24/outline";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { useOccupancy } from "../queries";
import type { OccupancyDay } from "../types";

const MONTH_NAMES = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
const WEEKDAY_LABELS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

const toIso = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Kelas warna sel menurut tingkat isi — merah = penuh/tutup. */
function cellTone(day: OccupancyDay | undefined): string {
  if (!day) return "bg-white";
  const used = day.online + day.walk_in;
  if (day.capacity === 0) return "bg-gray-100 text-gray-400";
  if (day.capacity === null) {
    return used > 0 ? "bg-blue-50" : "bg-white";
  }
  const ratio = used / day.capacity;
  if (ratio >= 1) return "bg-red-50 ring-1 ring-inset ring-red-200";
  if (ratio >= 0.7) return "bg-amber-50";
  if (used > 0) return "bg-emerald-50";
  return "bg-white";
}

interface OccupancyCalendarProps {
  /** Tanggal filter daftar booking yang sedang aktif (di-highlight). */
  selectedDate: string;
  onSelectDate: (iso: string) => void;
}

export function OccupancyCalendar({ selectedDate, onSelectDate }: OccupancyCalendarProps) {
  const now = new Date();
  const [view, setView] = useState({
    year: now.getFullYear(),
    month: now.getMonth(), // 0-11
  });

  const monthStart = toIso(view.year, view.month, 1);
  const daysInMonth = new Date(
    Date.UTC(view.year, view.month + 1, 0)
  ).getUTCDate();
  const monthEnd = toIso(view.year, view.month, daysInMonth);

  const occupancyQuery = useOccupancy(monthStart, monthEnd);
  const byDate = useMemo(
    () => new Map((occupancyQuery.data ?? []).map((d) => [d.date, d])),
    [occupancyQuery.data]
  );

  const cells = useMemo(() => {
    const firstDow = new Date(Date.UTC(view.year, view.month, 1)).getUTCDay();
    const leading = (firstDow + 6) % 7; // Senin = kolom pertama
    const list: (number | null)[] = Array.from({ length: leading }, () => null);
    for (let d = 1; d <= daysInMonth; d++) list.push(d);
    return list;
  }, [view, daysInMonth]);

  const shiftMonth = (delta: number) =>
    setView((v) => {
      const index = v.year * 12 + v.month + delta;
      return { year: Math.floor(index / 12), month: ((index % 12) + 12) % 12 };
    });

  return (
    <PurchasingListSection
      icon={CalendarDaysIcon}
      title="Okupansi Harian"
      description="(Booking online + walk-in loket) / kapasitas per tanggal. Klik tanggal untuk memfilter daftar booking."
      toolbar={
        <div className="flex items-center gap-1 text-sm font-medium text-gray-900">
          <button
            type="button"
            aria-label="Bulan sebelumnya"
            onClick={() => shiftMonth(-1)}
            className="flex h-8 w-8 items-center justify-center rounded-full text-gray-700 hover:bg-gray-100"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-32 text-center">
            {MONTH_NAMES[view.month]} {view.year}
          </span>
          <button
            type="button"
            aria-label="Bulan berikutnya"
            onClick={() => shiftMonth(1)}
            className="flex h-8 w-8 items-center justify-center rounded-full text-gray-700 hover:bg-gray-100"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      }
    >
      {occupancyQuery.isLoading ? (
        <div className="py-10 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" />
          <p className="mt-2 text-sm text-gray-500">Memuat okupansi...</p>
        </div>
      ) : (
        <div className="px-4 pb-4">
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAY_LABELS.map((label) => (
              <span
                key={label}
                className="pb-1 text-center text-[11px] font-medium text-gray-400"
              >
                {label}
              </span>
            ))}
            {cells.map((day, index) => {
              if (day === null) return <span key={`x-${index}`} />;
              const iso = toIso(view.year, view.month, day);
              const info = byDate.get(iso);
              const used = info ? info.online + info.walk_in : 0;
              const selected = iso === selectedDate;
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => onSelectDate(iso)}
                  aria-label={`${iso}: ${used} terpakai${
                    info?.capacity != null ? ` dari ${info.capacity}` : ""
                  }`}
                  className={`flex min-h-14 flex-col items-center justify-center rounded-lg border px-1 py-1.5 text-center transition-colors hover:border-gray-400 ${
                    selected ? "border-gray-900" : "border-gray-200/70"
                  } ${cellTone(info)}`}
                >
                  <span className="text-sm font-medium tabular-nums text-gray-900">
                    {day}
                  </span>
                  <span className="text-[10px] tabular-nums text-gray-500">
                    {info?.capacity === 0
                      ? "Tutup"
                      : info && (used > 0 || info.capacity !== null)
                        ? `${used}${info.capacity !== null ? `/${info.capacity}` : ""}`
                        : " "}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-500">
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded bg-emerald-50 ring-1 ring-inset ring-gray-200" /> terisi
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded bg-amber-50 ring-1 ring-inset ring-gray-200" /> ≥70%
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded bg-red-50 ring-1 ring-inset ring-red-200" /> penuh
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded bg-gray-100 ring-1 ring-inset ring-gray-200" /> tutup
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded bg-blue-50 ring-1 ring-inset ring-gray-200" /> terisi tanpa kuota
            </span>
          </div>
        </div>
      )}
    </PurchasingListSection>
  );
}

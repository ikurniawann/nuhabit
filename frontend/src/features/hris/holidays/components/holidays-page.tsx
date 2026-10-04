"use client";

import { useEffect, useState } from "react";
import { PlusIcon } from "@heroicons/react/24/outline";
import { ChevronLeft, ChevronRight, Download as DownloadIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { groupHolidaysByMonth } from "@/lib/hris/holidays-view";
import { useDeleteHoliday } from "../mutations";
import { useHolidays } from "../queries";
import type { HolidayRow } from "../types";
import { HolidayFormDialog } from "./holiday-form-dialog";
import { HolidayImportDialog } from "./holiday-import-dialog";
import { HolidayMonthCard } from "./holiday-month-card";

/**
 * HRIS → Kepegawaian → Hari Libur: master tanggal merah (libur nasional, cuti
 * bersama, libur perusahaan), sumber kebenaran untuk kalender ESS, monitoring
 * absensi, dan perhitungan hari cuti (EPIC-036).
 *
 * Daftar resmi terbit lewat SKB 3 Menteri dan tanggal hijriah bisa digeser
 * pemerintah H-beberapa hari, jadi halaman ini sengaja bisa diedit HRD tanpa
 * deploy, bukan konstanta di kode.
 */
export function HolidaysPage() {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const { data: holidays = [], isLoading, isError } = useHolidays(year);
  const remove = useDeleteHoliday();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<HolidayRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    if (isError) toast.error("Gagal memuat hari libur");
  }, [isError]);

  const byMonth = groupHolidaysByMonth(holidays);
  const activeCount = holidays.filter((h) => h.status === "aktif").length;
  const draftCount = holidays.length - activeCount;

  function openForm(holiday: HolidayRow | null) {
    setEditing(holiday);
    setFormOpen(true);
  }

  function handleSaved(savedYear: number) {
    setFormOpen(false);
    setYear(savedYear);
  }

  function handleDelete(holiday: HolidayRow) {
    if (!confirm(`Hapus "${holiday.name}" (${holiday.holiday_date})?`)) return;
    remove.mutate(holiday.id, {
      onSuccess: () => toast.success("Hari libur dihapus"),
      onError: (error) => toast.error(error.message || "Gagal menghapus"),
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-gray-200/70 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Hari Libur</h1>
          <p className="text-sm text-gray-500">
            Tanggal merah, cuti bersama & libur perusahaan — dipakai kalender absensi
            dan perhitungan hari cuti
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-full border border-gray-200 px-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setYear((y) => y - 1)}
              aria-label="Tahun sebelumnya"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-14 text-center text-sm font-semibold text-gray-900">{year}</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setYear((y) => y + 1)}
              aria-label="Tahun berikutnya"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <Button variant="outline" className="gap-2" onClick={() => setImportOpen(true)}>
            <DownloadIcon className="h-4 w-4" /> Impor kalender {year}
          </Button>
          <Button className="gap-2" onClick={() => openForm(null)}>
            <PlusIcon className="h-4 w-4" /> Tambah Libur
          </Button>
        </div>
      </div>

      {!isLoading && holidays.length > 0 && (
        <p className="text-xs text-gray-500">
          {activeCount} hari libur aktif di {year}
          {draftCount > 0 && (
            <span className="text-amber-600">
              {" "}
              · {draftCount} masih draft (belum mempengaruhi perhitungan apa pun)
            </span>
          )}
        </p>
      )}

      {isLoading ? (
        <div className="flex justify-center py-14">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : holidays.length === 0 ? (
        <p className="py-14 text-center text-sm text-gray-400">
          Belum ada hari libur untuk {year} — tambahkan mengacu SKB 3 Menteri.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {byMonth.map((rows, month) =>
            rows.length === 0 ? null : (
              <HolidayMonthCard
                key={month}
                month={month}
                holidays={rows}
                onEdit={openForm}
                onDelete={handleDelete}
              />
            )
          )}
        </div>
      )}

      <HolidayImportDialog open={importOpen} year={year} onOpenChange={setImportOpen} />
      <HolidayFormDialog
        open={formOpen}
        holiday={editing}
        year={year}
        onOpenChange={setFormOpen}
        onSaved={handleSaved}
      />
    </div>
  );
}

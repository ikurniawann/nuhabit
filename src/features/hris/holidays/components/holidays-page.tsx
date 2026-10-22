"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PlusIcon, PencilIcon, TrashIcon } from "@heroicons/react/24/outline";
import {
  ChevronLeft,
  ChevronRight,
  Download as DownloadIcon,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToastContainer, useToast } from "@/components/ui/toast";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api-client";
import type { HolidayType } from "@/lib/hris/holidays";

/**
 * HRIS → Kepegawaian → Hari Libur: master tanggal merah (libur nasional, cuti
 * bersama, libur perusahaan) — sumber kebenaran untuk kalender ESS, monitoring
 * absensi, dan perhitungan hari cuti (EPIC-036).
 *
 * Daftar resmi terbit lewat SKB 3 Menteri dan tanggal hijriah bisa digeser
 * pemerintah H-beberapa hari, jadi halaman ini sengaja bisa diedit HRD tanpa
 * deploy — bukan konstanta di kode.
 */

interface HolidayRow {
  id: string;
  holiday_date: string; // "YYYY-MM-DD"
  name: string;
  type: HolidayType;
  deducts_leave: boolean;
  status: "draft" | "aktif";
  source: "manual" | "impor";
  note: string | null;
}

/** Satu baris preview impor ICS (EPIC-036 Fase E). */
interface ImportRow {
  source_ref: string;
  holiday_date: string;
  name: string;
  type: HolidayType;
  deducts_leave: boolean;
  status: "draft" | "aktif";
  /** Dicentang otomatis? false = kandidat yang bukan tanggal merah. */
  suggested: boolean;
  reason?: string;
  already_imported: boolean;
}

const TYPE_META: Record<HolidayType, { label: string; className: string }> = {
  nasional: { label: "Libur Nasional", className: "bg-red-50 text-red-600 ring-red-100" },
  cuti_bersama: { label: "Cuti Bersama", className: "bg-amber-50 text-amber-700 ring-amber-100" },
  perusahaan: { label: "Libur Perusahaan", className: "bg-sky-50 text-sky-700 ring-sky-100" },
};

const MONTH_NAMES = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

function emptyForm(year: number) {
  return {
    holiday_date: `${year}-01-01`,
    name: "",
    type: "nasional" as HolidayType,
    deducts_leave: false,
    status: "aktif" as "draft" | "aktif",
    note: "",
  };
}

/** Label tanggal tanpa geser timezone — string sudah kunci kalender polos. */
function dayLabel(dateIso: string): { day: string; weekday: string } {
  const date = new Date(`${dateIso}T00:00:00`);
  return {
    day: String(date.getDate()).padStart(2, "0"),
    weekday: date.toLocaleDateString("id-ID", { weekday: "short" }),
  };
}

function monthIndexOf(dateIso: string): number {
  return Number(dateIso.slice(5, 7)) - 1;
}

export function HolidaysPage() {
  const { toasts, showToast, removeToast } = useToast();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [holidays, setHolidays] = useState<HolidayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<HolidayRow | null>(null);
  const [form, setForm] = useState(() => emptyForm(new Date().getFullYear()));
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importSaving, setImportSaving] = useState(false);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const load = useCallback(
    (targetYear: number) => {
      setLoading(true);
      apiGet<{ data: HolidayRow[] }>(
        `/api/hris/holidays?year=${targetYear}&include_draft=1`
      )
        .then((res) => setHolidays(res.data ?? []))
        .catch(() => showToast("Gagal memuat hari libur", "error"))
        .finally(() => setLoading(false));
    },
    // showToast stabil dari useToast; disengaja tidak masuk deps agar tidak refetch
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useEffect(() => {
    load(year);
  }, [year, load]);

  const byMonth = useMemo(() => {
    const groups: HolidayRow[][] = Array.from({ length: 12 }, () => []);
    for (const holiday of holidays) groups[monthIndexOf(holiday.holiday_date)].push(holiday);
    return groups;
  }, [holidays]);

  const activeCount = holidays.filter((h) => h.status === "aktif").length;
  const draftCount = holidays.length - activeCount;

  function openCreate() {
    setEditing(null);
    setForm(emptyForm(year));
    setDialogOpen(true);
  }

  /**
   * Impor kalender (EPIC-036 Fase E): tarik → preview bercentang → simpan.
   * Tidak ada yang tersimpan sebelum HRD menekan Simpan; entri yang bukan
   * tanggal merah datang dalam keadaan tidak tercentang beserta alasannya.
   */
  function openImport() {
    setImportOpen(true);
    setImportLoading(true);
    setImportRows([]);
    setImportError(null);
    apiGet<{ data: ImportRow[] }>(`/api/hris/holidays/import?year=${year}`)
      .then((res) => {
        const rows = res.data ?? [];
        setImportRows(rows);
        setChecked(
          new Set(
            rows.filter((r) => r.suggested && !r.already_imported).map((r) => r.source_ref)
          )
        );
      })
      .catch((error) =>
        setImportError(
          error instanceof Error ? error.message : "Gagal mengambil kalender"
        )
      )
      .finally(() => setImportLoading(false));
  }

  function toggleChecked(sourceRef: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(sourceRef)) next.delete(sourceRef);
      else next.add(sourceRef);
      return next;
    });
  }

  async function handleImportSave() {
    const items = importRows.filter((row) => checked.has(row.source_ref));
    if (items.length === 0) {
      showToast("Centang minimal satu hari libur", "error");
      return;
    }
    setImportSaving(true);
    try {
      const res = await apiPost<{ message?: string }>("/api/hris/holidays/import", {
        items: items.map((row) => ({
          source_ref: row.source_ref,
          holiday_date: row.holiday_date,
          name: row.name,
          type: row.type,
          deducts_leave: row.deducts_leave,
          status: row.status,
        })),
      });
      showToast(res.message ?? "Impor selesai");
      setImportOpen(false);
      load(year);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Gagal menyimpan impor", "error");
    } finally {
      setImportSaving(false);
    }
  }

  function openEdit(holiday: HolidayRow) {
    setEditing(holiday);
    setForm({
      holiday_date: holiday.holiday_date,
      name: holiday.name,
      type: holiday.type,
      deducts_leave: holiday.deducts_leave,
      status: holiday.status,
      note: holiday.note ?? "",
    });
    setDialogOpen(true);
  }

  /** Default mengikuti SKB: cuti bersama memotong jatah cuti, libur nasional tidak. */
  function changeType(type: HolidayType) {
    setForm((f) => ({ ...f, type, deducts_leave: type === "cuti_bersama" }));
  }

  async function handleSave() {
    if (!form.name.trim()) {
      showToast("Nama libur wajib diisi", "error");
      return;
    }
    setSaving(true);
    const payload = {
      holiday_date: form.holiday_date,
      name: form.name.trim(),
      type: form.type,
      deducts_leave: form.deducts_leave,
      status: form.status,
      note: form.note.trim() || null,
    };
    try {
      if (editing) {
        await apiPatch(`/api/hris/holidays/${editing.id}`, payload);
        showToast("Hari libur diperbarui");
      } else {
        await apiPost("/api/hris/holidays", payload);
        showToast("Hari libur ditambahkan");
      }
      setDialogOpen(false);
      const targetYear = Number(form.holiday_date.slice(0, 4));
      if (targetYear !== year) setYear(targetYear);
      else load(year);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Gagal menyimpan", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(holiday: HolidayRow) {
    if (!confirm(`Hapus "${holiday.name}" (${holiday.holiday_date})?`)) return;
    try {
      await apiDelete(`/api/hris/holidays/${holiday.id}`);
      showToast("Hari libur dihapus");
      load(year);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Gagal menghapus", "error");
    }
  }

  return (
    <div className="space-y-5">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-gray-200/70 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Hari Libur</h1>
          <p className="text-sm text-gray-500">
            Tanggal merah, cuti bersama & libur perusahaan — dipakai kalender absensi
            dan perhitungan hari cuti
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
          <Button variant="outline" className="gap-2" onClick={openImport}>
            <DownloadIcon className="h-4 w-4" /> Impor kalender {year}
          </Button>
          <Button className="gap-2" onClick={openCreate}>
            <PlusIcon className="h-4 w-4" /> Tambah Libur
          </Button>
        </div>
      </div>

      {!loading && holidays.length > 0 && (
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

      {loading ? (
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
              <div
                key={month}
                className="rounded-xl border border-gray-200/70 bg-white p-4 shadow-sm"
              >
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
                  {MONTH_NAMES[month]}
                </p>
                <ul className="space-y-2.5">
                  {rows.map((holiday) => {
                    const { day, weekday } = dayLabel(holiday.holiday_date);
                    const meta = TYPE_META[holiday.type];
                    return (
                      <li key={holiday.id} className="group flex items-start gap-3">
                        <div
                          className={`flex w-11 shrink-0 flex-col items-center rounded-lg py-1 ${
                            holiday.status === "draft"
                              ? "bg-gray-50 text-gray-400"
                              : "bg-red-50 text-red-600"
                          }`}
                        >
                          <span className="text-base font-bold leading-none">{day}</span>
                          <span className="text-[10px] uppercase">{weekday}</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-gray-900">
                            {holiday.name}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <span
                              className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ${meta.className}`}
                            >
                              {meta.label}
                            </span>
                            {holiday.deducts_leave && (
                              <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">
                                memotong jatah cuti
                              </span>
                            )}
                            {holiday.status === "draft" && (
                              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                                Draft
                              </span>
                            )}
                          </div>
                          {holiday.note && (
                            <p className="mt-1 text-[11px] leading-snug text-gray-400">
                              {holiday.note}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(holiday)}>
                            <PencilIcon className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-600"
                            onClick={() => handleDelete(holiday)}
                          >
                            <TrashIcon className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )
          )}
        </div>
      )}

      {/* Preview impor — tidak ada yang tersimpan sampai Simpan ditekan */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Impor Kalender Hari Libur {year}</DialogTitle>
          </DialogHeader>

          {importLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : importError ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <p className="font-semibold">Impor tidak tersedia</p>
              <p className="mt-1">{importError}</p>
            </div>
          ) : importRows.length === 0 ? (
            <p className="py-12 text-center text-sm text-gray-400">
              Kalender sumber tidak memuat entri untuk {year}.
            </p>
          ) : (
            <>
              <p className="text-xs text-gray-500">
                Centang yang benar-benar tanggal merah menurut SKB 3 Menteri. Entri
                yang bukan hari libur sudah tidak tercentang beserta alasannya, dan
                tanggal yang ditandai belum pasti masuk sebagai draft.
              </p>
              <div className="max-h-[52vh] space-y-1.5 overflow-y-auto pr-1">
                {importRows.map((row) => (
                  <label
                    key={row.source_ref}
                    className={`flex items-start gap-2.5 rounded-lg border p-2.5 ${
                      row.already_imported
                        ? "border-gray-100 bg-gray-50/60"
                        : "border-gray-200 hover:bg-slate-50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={checked.has(row.source_ref)}
                      onChange={() => toggleChecked(row.source_ref)}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900">
                        <span className="mr-2 font-mono text-xs text-gray-400">
                          {row.holiday_date}
                        </span>
                        {row.name}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ${
                            TYPE_META[row.type].className
                          }`}
                        >
                          {TYPE_META[row.type].label}
                        </span>
                        {row.deducts_leave && (
                          <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">
                            memotong jatah cuti
                          </span>
                        )}
                        {row.status === "draft" && (
                          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                            Draft
                          </span>
                        )}
                        {row.already_imported && (
                          <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700">
                            Sudah ada
                          </span>
                        )}
                      </div>
                      {row.reason && (
                        <p className="mt-1 text-[11px] leading-snug text-gray-400">
                          {row.reason}
                        </p>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              Batal
            </Button>
            <Button
              onClick={handleImportSave}
              disabled={importSaving || importLoading || checked.size === 0}
            >
              {importSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                `Simpan ${checked.size} libur`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Hari Libur" : "Tambah Hari Libur"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Tanggal</label>
              <Input
                type="date"
                value={form.holiday_date}
                onChange={(e) => setForm((f) => ({ ...f, holiday_date: e.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Nama libur</label>
              <Input
                placeholder="cth. Hari Kemerdekaan Republik Indonesia"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Tipe</label>
                <Select value={form.type} onValueChange={(v) => changeType(v as HolidayType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(TYPE_META) as HolidayType[]).map((type) => (
                      <SelectItem key={type} value={type}>
                        {TYPE_META[type].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Status</label>
                <Select
                  value={form.status}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, status: v as "draft" | "aktif" }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="aktif">Aktif</SelectItem>
                    <SelectItem value="draft">Draft (belum berlaku)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={form.deducts_leave}
                onChange={(e) => setForm((f) => ({ ...f, deducts_leave: e.target.checked }))}
              />
              <span>
                Tetap memotong jatah cuti tahunan
                <span className="block text-xs text-gray-400">
                  Menurut SKB, cuti bersama memotong jatah cuti — libur nasional tidak.
                </span>
              </span>
            </label>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Catatan (opsional)
              </label>
              <Input
                placeholder="cth. tanggal tentatif, verifikasi ke SKB resmi"
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Batal
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

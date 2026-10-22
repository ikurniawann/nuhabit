"use client";

import { useEffect, useState } from "react";
import { PlusIcon, PencilIcon, TrashIcon, MoonIcon } from "@heroicons/react/24/outline";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ToastContainer, useToast } from "@/components/ui/toast";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api-client";

/**
 * HRIS → Kepegawaian → Shift Kerja: master shift (jam kerja + toleransi
 * terlambat) yang menjadi acuan jadwal per karyawan dan perhitungan
 * keterlambatan absensi.
 */

export interface ShiftRow {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
  late_tolerance_minutes: number;
  is_overnight: boolean;
  is_active: boolean;
  sort_order: number;
}

const EMPTY_FORM = {
  name: "",
  start_time: "08:00",
  end_time: "16:00",
  break_minutes: "60",
  late_tolerance_minutes: "10",
  is_overnight: false,
};

function hhmm(time: string): string {
  return time.slice(0, 5);
}

export function ShiftsPage() {
  const { toasts, showToast, removeToast } = useToast();
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ShiftRow | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  function load() {
    apiGet<{ data: ShiftRow[] }>("/api/hris/shifts")
      .then((res) => setShifts(res.data ?? []))
      .catch(() => showToast("Gagal memuat shift", "error"))
      .finally(() => setLoading(false));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(shift: ShiftRow) {
    setEditing(shift);
    setForm({
      name: shift.name,
      start_time: hhmm(shift.start_time),
      end_time: hhmm(shift.end_time),
      break_minutes: String(shift.break_minutes),
      late_tolerance_minutes: String(shift.late_tolerance_minutes),
      is_overnight: shift.is_overnight,
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) {
      showToast("Nama shift wajib diisi", "error");
      return;
    }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      start_time: form.start_time,
      end_time: form.end_time,
      break_minutes: Number(form.break_minutes) || 0,
      late_tolerance_minutes: Number(form.late_tolerance_minutes) || 0,
      is_overnight: form.is_overnight,
    };
    try {
      if (editing) {
        await apiPatch(`/api/hris/shifts/${editing.id}`, payload);
        showToast("Shift diperbarui");
      } else {
        await apiPost("/api/hris/shifts", payload);
        showToast("Shift dibuat");
      }
      setDialogOpen(false);
      load();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Gagal menyimpan", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(shift: ShiftRow) {
    if (!confirm(`Hapus shift "${shift.name}"?`)) return;
    try {
      await apiDelete(`/api/hris/shifts/${shift.id}`);
      showToast("Shift dihapus / dinonaktifkan");
      load();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Gagal menghapus", "error");
    }
  }

  return (
    <div className="space-y-5">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-gray-200/70 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Shift Kerja</h1>
          <p className="text-sm text-gray-500">
            Master jam kerja — dipakai jadwal per karyawan & perhitungan keterlambatan absen
          </p>
        </div>
        <Button className="gap-2" onClick={openCreate}>
          <PlusIcon className="h-4 w-4" /> Tambah Shift
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-14">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shifts.map((shift) => (
            <div
              key={shift.id}
              className={`rounded-xl border bg-white p-4 shadow-sm ${
                shift.is_active ? "border-gray-200/70" : "border-dashed border-gray-300 opacity-60"
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="flex items-center gap-1.5 font-semibold text-gray-900">
                    {shift.name}
                    {shift.is_overnight && <MoonIcon className="h-4 w-4 text-indigo-500" />}
                    {!shift.is_active && (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs">Nonaktif</span>
                    )}
                  </p>
                  <p className="mt-1 text-2xl font-bold text-gray-900">
                    {hhmm(shift.start_time)}–{hhmm(shift.end_time)}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    Istirahat {shift.break_minutes} mnt · toleransi terlambat{" "}
                    {shift.late_tolerance_minutes} mnt
                    {shift.is_overnight ? " · lewat tengah malam" : ""}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => openEdit(shift)}>
                    <PencilIcon className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-600"
                    onClick={() => handleDelete(shift)}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
          {shifts.length === 0 && (
            <p className="col-span-full py-10 text-center text-sm text-gray-400">
              Belum ada shift — tambahkan dulu untuk mengatur jadwal karyawan.
            </p>
          )}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : "Tambah Shift"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Nama shift</label>
              <Input
                placeholder="cth. Shift Pagi"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Jam mulai</label>
                <Input
                  type="time"
                  value={form.start_time}
                  onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Jam selesai</label>
                <Input
                  type="time"
                  value={form.end_time}
                  onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Istirahat (menit)
                </label>
                <Input
                  type="number"
                  value={form.break_minutes}
                  onChange={(e) => setForm((f) => ({ ...f, break_minutes: e.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Toleransi terlambat (menit)
                </label>
                <Input
                  type="number"
                  value={form.late_tolerance_minutes}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, late_tolerance_minutes: e.target.value }))
                  }
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={form.is_overnight}
                onChange={(e) => setForm((f) => ({ ...f, is_overnight: e.target.checked }))}
              />
              Shift malam (jam selesai jatuh keesokan hari)
            </label>
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

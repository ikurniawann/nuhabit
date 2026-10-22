"use client";

import { useCallback, useEffect, useState } from "react";
import { ClockIcon, PaperAirplaneIcon, BellAlertIcon } from "@heroicons/react/24/outline";
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

/**
 * ESS → Lembur (/dashboard/me/lembur): pengajuan lembur mandiri +
 * konfirmasi penugasan lembur dari perusahaan (dibuat HRD).
 * Jam lembur approved yang terealisasi (ada clock-out) otomatis masuk payroll.
 */

interface MeData {
  employee: { id: string; full_name: string } | null;
}

interface OvertimeRow {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  hours: string | number;
  source: "employee" | "company";
  status: string;
  reason: string | null;
  rejection_reason: string | null;
  requester?: { full_name: string } | null;
}

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  pending: { label: "Menunggu", className: "bg-amber-100 text-amber-700" },
  approved: { label: "Disetujui", className: "bg-green-100 text-green-700" },
  rejected: { label: "Ditolak", className: "bg-red-100 text-red-700" },
  cancelled: { label: "Dibatalkan", className: "bg-gray-100 text-gray-600" },
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

function formatTime(value: string): string {
  return value?.slice(0, 5) ?? "—";
}

const EMPTY_FORM = { date: "", start_time: "", end_time: "", reason: "" };

export function EssLemburPage() {
  const { toasts, showToast, removeToast } = useToast();
  const [me, setMe] = useState<MeData | null>(null);
  const [loadingMe, setLoadingMe] = useState(true);
  const [rows, setRows] = useState<OvertimeRow[]>([]);
  const [dialog, setDialog] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [decidingId, setDecidingId] = useState<string | null>(null);

  const loadRows = useCallback(() => {
    fetch("/api/hris/overtime")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => setRows(json?.data ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/hris/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => setMe(json?.data ?? null))
      .catch(() => {})
      .finally(() => setLoadingMe(false));
    loadRows();
  }, [loadRows]);

  async function handleSubmit() {
    if (!form.date || !form.start_time || !form.end_time) {
      showToast("Tanggal dan jam lembur wajib diisi", "error");
      return;
    }
    if (form.reason.trim().length < 5) {
      showToast("Alasan minimal 5 karakter", "error");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/hris/overtime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Gagal mengajukan lembur");
      showToast("Pengajuan lembur terkirim — menunggu persetujuan");
      setDialog(false);
      setForm(EMPTY_FORM);
      loadRows();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Gagal mengajukan lembur", "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDecide(id: string, action: "approve" | "reject" | "cancel") {
    let rejection_reason: string | undefined;
    if (action === "reject") {
      rejection_reason = window.prompt("Alasan menolak penugasan ini?") ?? undefined;
      if (!rejection_reason?.trim()) return;
    }
    setDecidingId(id);
    try {
      const res = await fetch("/api/hris/overtime/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overtime_id: id, action, rejection_reason }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Gagal memproses");
      showToast(json.message || "Berhasil diproses");
      loadRows();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Gagal memproses", "error");
    } finally {
      setDecidingId(null);
    }
  }

  if (loadingMe) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!me?.employee) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <p className="text-lg font-semibold text-gray-800">
          Akun ini tidak terhubung ke data karyawan
        </p>
        <p className="mt-2 text-sm text-gray-500">
          Pengajuan lembur hanya tersedia untuk akun yang tertaut ke record
          karyawan HRIS. Hubungi HRD bila menurut Anda ini keliru.
        </p>
      </div>
    );
  }

  const companyAssignments = rows.filter(
    (row) => row.source === "company" && row.status === "pending"
  );
  const history = rows.filter(
    (row) => !(row.source === "company" && row.status === "pending")
  );

  return (
    <div className="space-y-6">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-gray-200/70 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Lembur</h1>
          <p className="text-sm text-gray-500">
            Ajukan lembur atau konfirmasi penugasan lembur dari perusahaan
          </p>
        </div>
        <Button className="gap-2" onClick={() => setDialog(true)}>
          <PaperAirplaneIcon className="h-4 w-4" /> Ajukan Lembur
        </Button>
      </div>

      {companyAssignments.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-5 shadow-sm">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-800">
            <BellAlertIcon className="h-4 w-4" /> Penugasan Lembur dari Perusahaan —
            butuh konfirmasi Anda
          </h3>
          <ul className="mt-3 divide-y divide-amber-100">
            {companyAssignments.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    {formatDate(row.date)} · {formatTime(row.start_time)}–{formatTime(row.end_time)}{" "}
                    ({Number(row.hours)} jam)
                  </p>
                  <p className="truncate text-xs text-gray-600">
                    {row.reason || "—"}
                    {row.requester?.full_name ? ` · Ditugaskan oleh ${row.requester.full_name}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    disabled={decidingId === row.id}
                    onClick={() => handleDecide(row.id, "approve")}
                  >
                    Konfirmasi
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={decidingId === row.id}
                    onClick={() => handleDecide(row.id, "reject")}
                  >
                    Tolak
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-xl border border-gray-200/70 bg-white p-5 shadow-sm">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-800">
          <ClockIcon className="h-4 w-4 text-pink-500" /> Riwayat Lembur
        </h3>
        {history.length === 0 ? (
          <p className="mt-4 py-6 text-center text-sm text-gray-400">Belum ada pengajuan lembur.</p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-100">
            {history.map((row) => {
              const badge = STATUS_BADGES[row.status] ?? STATUS_BADGES.pending;
              return (
                <li key={row.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">
                      {formatDate(row.date)} · {formatTime(row.start_time)}–{formatTime(row.end_time)}{" "}
                      ({Number(row.hours)} jam)
                      {row.source === "company" && (
                        <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">
                          Penugasan
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-gray-500">
                      {row.reason || "—"}
                      {row.status === "rejected" && row.rejection_reason
                        ? ` · Alasan ditolak: ${row.rejection_reason}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {row.source === "employee" && row.status === "pending" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-xs text-gray-500"
                        disabled={decidingId === row.id}
                        onClick={() => handleDecide(row.id, "cancel")}
                      >
                        Batalkan
                      </Button>
                    )}
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Ajukan Lembur</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Tanggal</label>
              <Input
                type="date"
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Jam Mulai</label>
                <Input
                  type="time"
                  value={form.start_time}
                  onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Jam Selesai</label>
                <Input
                  type="time"
                  value={form.end_time}
                  onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Alasan / pekerjaan yang dilembur (min. 5 karakter)
              </label>
              <Input
                placeholder="cth. closing stok bulanan"
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              />
            </div>
            <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-700">
              Lembur yang disetujui akan dibayar sesuai jam yang terealisasi
              (wajib absen clock-in/out pada hari tersebut).
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>
              Batal
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Kirim Pengajuan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

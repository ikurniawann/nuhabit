"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarDaysIcon, ClockIcon, PaperAirplaneIcon } from "@heroicons/react/24/outline";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ToastContainer, useToast } from "@/components/ui/toast";
import { describeLeaveDays, type LeaveDaysBreakdown } from "@/lib/hris/holidays";
import { fetchHolidayIndex } from "@/lib/hris/holidays-client";

/**
 * ESS → Izin & Cuti (/dashboard/me/cuti): kuota tahunan, riwayat pengajuan,
 * dan form pengajuan mandiri (server memaksa employee_id = diri sendiri).
 */

interface MeData {
  employee: { id: string; full_name: string } | null;
  leave_balance: {
    year: number;
    annual_leave_total: string;
    annual_leave_used: string;
    annual_leave_remaining: string;
  } | null;
}

interface LeaveRow {
  id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  total_days: number;
  status: string;
  reason: string;
  rejection_reason: string | null;
  is_short_notice?: boolean;
}

const LEAVE_TYPE_OPTIONS = [
  { value: "annual", label: "Cuti Tahunan" },
  { value: "sick", label: "Sakit" },
  { value: "emergency", label: "Izin Darurat" },
  { value: "unpaid", label: "Izin Tanpa Gaji" },
  { value: "maternity", label: "Cuti Melahirkan" },
  { value: "paternity", label: "Cuti Ayah" },
  { value: "menstrual", label: "Cuti Haid" },
  { value: "pilgrimage", label: "Ibadah" },
  { value: "marriage", label: "Menikah" },
  { value: "bereavement", label: "Duka" },
];

const LEAVE_STATUS_BADGES: Record<string, { label: string; className: string }> = {
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

function leaveTypeLabel(value: string): string {
  return LEAVE_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

const EMPTY_LEAVE_FORM = { leave_type: "annual", start_date: "", end_date: "", reason: "" };

export function EssCutiPage() {
  const { toasts, showToast, removeToast } = useToast();
  const [me, setMe] = useState<MeData | null>(null);
  const [loadingMe, setLoadingMe] = useState(true);
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [leaveDialog, setLeaveDialog] = useState(false);
  const [leaveForm, setLeaveForm] = useState(EMPTY_LEAVE_FORM);
  const [leaveDays, setLeaveDays] = useState<LeaveDaysBreakdown | null>(null);
  const [attachment, setAttachment] = useState<{ name: string; dataUrl: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleAttachmentChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast("Lampiran harus berupa gambar (foto surat dokter dsb.)", "error");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast("Ukuran lampiran maksimal 5 MB", "error");
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () =>
      setAttachment({ name: file.name, dataUrl: reader.result as string });
    reader.readAsDataURL(file);
  }

  const loadLeaves = useCallback(() => {
    fetch("/api/hris/leaves?limit=20")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => setLeaves(json?.data ?? []))
      .catch(() => {});
  }, []);

  /**
   * Pratinjau potongan jatah cuti (EPIC-036 Fase D). Angka yang mengikat tetap
   * dihitung ulang server saat disimpan — ini supaya karyawan tahu lebih dulu
   * kenapa cuti 5 hari kalender bisa hanya memotong 3 hari jatah.
   */
  const leaveStart = leaveForm.start_date;
  const leaveEnd = leaveForm.end_date;
  useEffect(() => {
    if (!leaveStart || !leaveEnd || leaveEnd < leaveStart) {
      setLeaveDays(null);
      return;
    }
    let cancelled = false;
    void fetchHolidayIndex(leaveStart, leaveEnd).then((index) => {
      if (!cancelled) setLeaveDays(describeLeaveDays(leaveStart, leaveEnd, index));
    });
    return () => {
      cancelled = true;
    };
  }, [leaveStart, leaveEnd]);

  useEffect(() => {
    fetch("/api/hris/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => setMe(json?.data ?? null))
      .catch(() => {})
      .finally(() => setLoadingMe(false));
    loadLeaves();
  }, [loadLeaves]);

  async function handleSubmitLeave() {
    if (!leaveForm.start_date || !leaveForm.end_date) {
      showToast("Tanggal mulai dan selesai wajib diisi", "error");
      return;
    }
    if (leaveForm.reason.trim().length < 10) {
      showToast("Alasan minimal 10 karakter", "error");
      return;
    }
    setSubmitting(true);
    try {
      // upload lampiran dulu (bila ada), lalu kirim pengajuan dgn path-nya
      let attachmentUrl: string | undefined;
      if (attachment) {
        const uploadRes = await fetch("/api/hris/leaves/attachment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photo: attachment.dataUrl }),
        });
        const uploadJson = await uploadRes.json();
        if (!uploadRes.ok) throw new Error(uploadJson.error || "Gagal upload lampiran");
        attachmentUrl = uploadJson.data.path;
      }

      const res = await fetch("/api/hris/leaves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...leaveForm, attachment_url: attachmentUrl }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Gagal mengajukan");
      // Coach di bawah minimal pemberitahuan SOP → pesan "tercatat mendadak" dari API (EPIC-067).
      showToast(json.data?.is_short_notice && json.message ? json.message : "Pengajuan terkirim — menunggu persetujuan");
      setLeaveDialog(false);
      setLeaveForm(EMPTY_LEAVE_FORM);
      setAttachment(null);
      loadLeaves();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Gagal mengajukan", "error");
    } finally {
      setSubmitting(false);
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
          Pengajuan izin/cuti hanya tersedia untuk akun yang tertaut ke record karyawan
          HRIS. Hubungi HRD bila menurut Anda ini keliru.
        </p>
      </div>
    );
  }

  const balance = me.leave_balance;

  return (
    <div className="space-y-6">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <div className="border-b border-gray-200/70 pb-4">
        <h1 className="text-2xl font-bold text-gray-900">Izin & Cuti</h1>
        <p className="text-sm text-gray-500">Ajukan dan pantau izin/cuti Anda</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-gray-200/70 bg-white p-5 shadow-sm">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-800">
            <CalendarDaysIcon className="h-4 w-4 text-pink-500" /> Kuota Cuti Tahunan{" "}
            {balance?.year ?? new Date().getFullYear()}
          </h3>
          <p className="mt-3 text-3xl font-bold text-gray-900">
            {balance ? Number(balance.annual_leave_remaining) : "12"}
            <span className="ml-1 text-base font-normal text-gray-500">hari tersisa</span>
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Terpakai {balance ? Number(balance.annual_leave_used) : 0} dari{" "}
            {balance ? Number(balance.annual_leave_total) : 12} hari
          </p>
          <Button className="mt-4 w-full gap-2" onClick={() => setLeaveDialog(true)}>
            <PaperAirplaneIcon className="h-4 w-4" /> Ajukan Izin / Cuti
          </Button>
        </div>

        <div className="rounded-xl border border-gray-200/70 bg-white p-5 shadow-sm lg:col-span-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-800">
            <ClockIcon className="h-4 w-4 text-pink-500" /> Riwayat Pengajuan
          </h3>
          {leaves.length === 0 ? (
            <p className="mt-4 py-6 text-center text-sm text-gray-400">Belum ada pengajuan.</p>
          ) : (
            <ul className="mt-3 divide-y divide-gray-100">
              {leaves.map((leave) => {
                const badge = LEAVE_STATUS_BADGES[leave.status] ?? LEAVE_STATUS_BADGES.pending;
                return (
                  <li key={leave.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">
                        {leaveTypeLabel(leave.leave_type)} · {leave.total_days} hari
                        {leave.is_short_notice && (
                          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                            Mendadak
                          </span>
                        )}
                      </p>
                      <p className="truncate text-xs text-gray-500">
                        {formatDate(leave.start_date)} — {formatDate(leave.end_date)}
                        {leave.status === "rejected" && leave.rejection_reason
                          ? ` · Alasan ditolak: ${leave.rejection_reason}`
                          : ""}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <Dialog open={leaveDialog} onOpenChange={setLeaveDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Ajukan Izin / Cuti</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Jenis</label>
              <Combobox
                options={LEAVE_TYPE_OPTIONS}
                value={leaveForm.leave_type}
                onChange={(value) => setLeaveForm((f) => ({ ...f, leave_type: value }))}
                placeholder="Pilih jenis"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Mulai</label>
                <Input
                  type="date"
                  value={leaveForm.start_date}
                  onChange={(e) => setLeaveForm((f) => ({ ...f, start_date: e.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Selesai</label>
                <Input
                  type="date"
                  value={leaveForm.end_date}
                  onChange={(e) => setLeaveForm((f) => ({ ...f, end_date: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Alasan (min. 10 karakter)
              </label>
              <Input
                placeholder="cth. keperluan keluarga di luar kota"
                value={leaveForm.reason}
                onChange={(e) => setLeaveForm((f) => ({ ...f, reason: e.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Lampiran (ops. — foto surat dokter dsb., maks 5 MB)
              </label>
              <Input type="file" accept="image/*" onChange={handleAttachmentChange} />
              {attachment && (
                <p className="mt-1 text-xs text-gray-500">📎 {attachment.name}</p>
              )}
            </div>
            {/* Pratinjau potongan jatah (EPIC-036 Fase D) — akhir pekan dan
                tanggal merah tidak memotong, cuti bersama tetap memotong. */}
            {leaveDays !== null && (
              <div
                className={`rounded-lg px-3 py-2 text-xs ${
                  leaveDays.totalDays === 0
                    ? "bg-amber-50 text-amber-800"
                    : "bg-emerald-50 text-emerald-800"
                }`}
              >
                {leaveDays.totalDays === 0 ? (
                  <p>
                    Rentang ini sudah libur seluruhnya
                    {leaveDays.excludedHolidays.length > 0 &&
                      ` (${leaveDays.excludedHolidays.map((h) => h.name).join(", ")})`}
                    {" "}— tidak perlu mengajukan cuti.
                  </p>
                ) : (
                  <>
                    <p className="font-semibold">
                      Memotong jatah {leaveDays.totalDays} hari
                    </p>
                    {leaveDays.excludedHolidays.length > 0 && (
                      <p className="mt-0.5">
                        Tidak dipotong:{" "}
                        {leaveDays.excludedHolidays.map((h) => h.name).join(", ")}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
            {leaveForm.leave_type === "annual" && balance && (
              <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-700">
                Sisa kuota cuti tahunan Anda: {Number(balance.annual_leave_remaining)} hari.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLeaveDialog(false)}>
              Batal
            </Button>
            <Button onClick={handleSubmitLeave} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Kirim Pengajuan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { ClockIcon, PlusIcon } from "@heroicons/react/24/outline";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ToastContainer, useToast } from "@/components/ui/toast";

/**
 * HRD → Kepegawaian → Lembur (/dashboard/hris/overtime):
 * kelola pengajuan lembur karyawan (approve/reject) dan buat penugasan
 * lembur atas nama perusahaan (dikonfirmasi karyawan via ESS).
 */

interface OvertimeRow {
  id: string;
  employee_id: string;
  date: string;
  start_time: string;
  end_time: string;
  hours: string | number;
  source: "employee" | "company";
  status: string;
  reason: string | null;
  rejection_reason: string | null;
  employee?: { id: string; full_name: string; nip: string | null } | null;
  requester?: { full_name: string } | null;
  decider?: { full_name: string } | null;
}

interface EmployeeOption {
  id: string;
  full_name: string;
  nip: string | null;
}

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  pending: { label: "Menunggu", className: "bg-amber-100 text-amber-700" },
  approved: { label: "Disetujui", className: "bg-green-100 text-green-700" },
  rejected: { label: "Ditolak", className: "bg-red-100 text-red-700" },
  cancelled: { label: "Dibatalkan", className: "bg-gray-100 text-gray-600" },
};

const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "Semua Status" },
  { value: "pending", label: "Menunggu" },
  { value: "approved", label: "Disetujui" },
  { value: "rejected", label: "Ditolak" },
  { value: "cancelled", label: "Dibatalkan" },
];

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

function formatTime(value: string): string {
  return value?.slice(0, 5) ?? "—";
}

function currentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

const EMPTY_ASSIGN_FORM = {
  employee_id: "",
  date: "",
  start_time: "",
  end_time: "",
  reason: "",
};

export function OvertimePage() {
  const { toasts, showToast, removeToast } = useToast();
  const [rows, setRows] = useState<OvertimeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState(currentMonthValue());
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [assignDialog, setAssignDialog] = useState(false);
  const [assignForm, setAssignForm] = useState(EMPTY_ASSIGN_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [decidingId, setDecidingId] = useState<string | null>(null);

  const loadRows = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (monthFilter) {
      const [year, month] = monthFilter.split("-");
      params.set("year", year);
      params.set("month", month);
    }
    fetch(`/api/hris/overtime?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => setRows(json?.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [statusFilter, monthFilter]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  useEffect(() => {
    fetch("/api/hris/employees?is_active=true&limit=500")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => setEmployees(json?.data ?? []))
      .catch(() => {});
  }, []);

  async function handleAssign() {
    if (!assignForm.employee_id) {
      showToast("Pilih karyawan yang ditugaskan", "error");
      return;
    }
    if (!assignForm.date || !assignForm.start_time || !assignForm.end_time) {
      showToast("Tanggal dan jam lembur wajib diisi", "error");
      return;
    }
    if (assignForm.reason.trim().length < 5) {
      showToast("Alasan/pekerjaan minimal 5 karakter", "error");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/hris/overtime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(assignForm),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Gagal membuat penugasan");
      showToast(json.message || "Penugasan lembur dibuat");
      setAssignDialog(false);
      setAssignForm(EMPTY_ASSIGN_FORM);
      loadRows();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Gagal membuat penugasan", "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDecide(id: string, action: "approve" | "reject" | "cancel") {
    let rejection_reason: string | undefined;
    if (action === "reject") {
      rejection_reason = window.prompt("Alasan penolakan?") ?? undefined;
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

  const employeeOptions = employees.map((emp) => ({
    value: emp.id,
    label: emp.nip ? `${emp.full_name} (${emp.nip})` : emp.full_name,
  }));

  const pendingEmployeeRequests = rows.filter(
    (row) => row.source === "employee" && row.status === "pending"
  ).length;

  return (
    <div className="space-y-6 pb-12">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Lembur</h1>
          <p className="text-sm text-gray-500">
            Persetujuan pengajuan lembur karyawan & penugasan lembur perusahaan
            {pendingEmployeeRequests > 0
              ? ` · ${pendingEmployeeRequests} pengajuan menunggu persetujuan`
              : ""}
          </p>
        </div>
        <Button className="bg-pink-600 hover:bg-pink-700" onClick={() => setAssignDialog(true)}>
          <PlusIcon className="mr-2 h-4 w-4" /> Tugaskan Lembur
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTER_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="month"
          className="w-44"
          value={monthFilter}
          onChange={(e) => setMonthFilter(e.target.value)}
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200/70 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-4 py-3">Karyawan</th>
              <th className="px-4 py-3">Tanggal</th>
              <th className="px-4 py-3">Jam</th>
              <th className="px-4 py-3">Durasi</th>
              <th className="px-4 py-3">Sumber</th>
              <th className="px-4 py-3">Alasan</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="py-10 text-center text-gray-400">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-10 text-center text-gray-400">
                  Tidak ada pengajuan lembur pada filter ini.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const badge = STATUS_BADGES[row.status] ?? STATUS_BADGES.pending;
                return (
                  <tr key={row.id} className="border-b last:border-0 hover:bg-gray-50/60">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {row.employee?.full_name ?? "—"}
                    </td>
                    <td className="px-4 py-3">{formatDate(row.date)}</td>
                    <td className="px-4 py-3">
                      {formatTime(row.start_time)}–{formatTime(row.end_time)}
                    </td>
                    <td className="px-4 py-3">{Number(row.hours)} jam</td>
                    <td className="px-4 py-3">
                      {row.source === "company" ? (
                        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">
                          Perusahaan
                        </span>
                      ) : (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                          Karyawan
                        </span>
                      )}
                    </td>
                    <td className="max-w-[220px] truncate px-4 py-3 text-gray-600" title={row.reason ?? ""}>
                      {row.reason || "—"}
                      {row.status === "rejected" && row.rejection_reason
                        ? ` · Ditolak: ${row.rejection_reason}`
                        : ""}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.status === "pending" && row.source === "employee" && (
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            disabled={decidingId === row.id}
                            onClick={() => handleDecide(row.id, "approve")}
                          >
                            Setujui
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
                      )}
                      {row.status === "pending" && row.source === "company" && (
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-xs text-gray-400">Menunggu konfirmasi karyawan</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-xs text-gray-500"
                            disabled={decidingId === row.id}
                            onClick={() => handleDecide(row.id, "cancel")}
                          >
                            Batalkan
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={assignDialog} onOpenChange={setAssignDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Tugaskan Lembur (dari Perusahaan)</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Karyawan</label>
              <Combobox
                options={employeeOptions}
                value={assignForm.employee_id}
                onChange={(value) => setAssignForm((f) => ({ ...f, employee_id: value }))}
                placeholder="Pilih karyawan"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Tanggal</label>
              <Input
                type="date"
                value={assignForm.date}
                onChange={(e) => setAssignForm((f) => ({ ...f, date: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Jam Mulai</label>
                <Input
                  type="time"
                  value={assignForm.start_time}
                  onChange={(e) => setAssignForm((f) => ({ ...f, start_time: e.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Jam Selesai</label>
                <Input
                  type="time"
                  value={assignForm.end_time}
                  onChange={(e) => setAssignForm((f) => ({ ...f, end_time: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Pekerjaan yang dilembur (min. 5 karakter)
              </label>
              <Input
                placeholder="cth. stock opname akhir bulan"
                value={assignForm.reason}
                onChange={(e) => setAssignForm((f) => ({ ...f, reason: e.target.value }))}
              />
            </div>
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              <ClockIcon className="mr-1 inline h-3.5 w-3.5" />
              Penugasan menunggu konfirmasi karyawan di halaman ESS Lembur.
              Jam lembur dibayar sesuai realisasi absensi.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignDialog(false)}>
              Batal
            </Button>
            <Button onClick={handleAssign} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Buat Penugasan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

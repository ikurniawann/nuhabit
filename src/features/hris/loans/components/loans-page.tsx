"use client";

import { useCallback, useEffect, useState } from "react";
import { BanknotesIcon, PlusIcon } from "@heroicons/react/24/outline";
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
 * HRIS → Penggajian → Pinjaman (/dashboard/hris/loans):
 * pengajuan pinjaman/kasbon karyawan, approval, dan progres pelunasan.
 * Cicilan pinjaman approved otomatis terpotong di payroll (EPIC-008 Fase D);
 * saldo berkurang saat run payroll ditandai dibayar.
 */

interface LoanRow {
  id: string;
  employee_id: string;
  loan_type: string;
  principal_amount: string | number;
  interest_rate: string | number;
  tenor_months: number;
  monthly_installment: string | number;
  remaining_balance: string | number;
  paid_amount: string | number;
  first_installment_month: number | null;
  first_installment_year: number | null;
  status: string;
  purpose: string | null;
  rejection_reason: string | null;
  created_at: string;
  employee?: {
    id: string;
    full_name: string;
    nip: string | null;
    department?: { name: string } | null;
  } | null;
}

interface EmployeeOption {
  id: string;
  full_name: string;
  nip: string | null;
}

const LOAN_TYPE_OPTIONS = [
  { value: "kasbon", label: "Kasbon (Salary Advance)" },
  { value: "loan", label: "Pinjaman" },
  { value: "emergency", label: "Pinjaman Darurat" },
];

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  pending: { label: "Menunggu", className: "bg-amber-100 text-amber-700" },
  approved: { label: "Berjalan", className: "bg-green-100 text-green-700" },
  rejected: { label: "Ditolak", className: "bg-red-100 text-red-700" },
  paid_off: { label: "Lunas", className: "bg-sky-100 text-sky-700" },
};

const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "Semua Status" },
  { value: "pending", label: "Menunggu" },
  { value: "approved", label: "Berjalan" },
  { value: "paid_off", label: "Lunas" },
  { value: "rejected", label: "Ditolak" },
];

function formatCurrency(amount: string | number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(Number(amount) || 0);
}

function loanTypeLabel(value: string): string {
  return LOAN_TYPE_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

const EMPTY_FORM = {
  employee_id: "",
  loan_type: "kasbon",
  principal_amount: "",
  interest_rate: "0",
  tenor_months: "3",
  purpose: "",
};

export function LoansPage() {
  const { toasts, showToast, removeToast } = useToast();
  const [rows, setRows] = useState<LoanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [dialog, setDialog] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [decidingId, setDecidingId] = useState<string | null>(null);

  const loadRows = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter);
    fetch(`/api/hris/loans?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => setRows(json?.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [statusFilter]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  useEffect(() => {
    fetch("/api/hris/employees?is_active=true&limit=500")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => setEmployees(json?.data ?? []))
      .catch(() => {});
  }, []);

  const previewInstallment = (() => {
    const principal = Number(form.principal_amount);
    const tenor = Number(form.tenor_months);
    const rate = Number(form.interest_rate) || 0;
    if (!principal || !tenor) return null;
    const installment = rate
      ? (principal * (1 + (rate / 100) * tenor)) / tenor
      : principal / tenor;
    return Math.round(installment);
  })();

  async function handleSubmit() {
    if (!form.employee_id) {
      showToast("Pilih karyawan", "error");
      return;
    }
    if (!Number(form.principal_amount) || !Number(form.tenor_months)) {
      showToast("Jumlah pinjaman dan tenor wajib diisi", "error");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/hris/loans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: form.employee_id,
          loan_type: form.loan_type,
          principal_amount: Number(form.principal_amount),
          interest_rate: Number(form.interest_rate) || 0,
          tenor_months: Number(form.tenor_months),
          purpose: form.purpose || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Gagal membuat pengajuan");
      showToast(json.message || "Pengajuan pinjaman dibuat");
      setDialog(false);
      setForm(EMPTY_FORM);
      loadRows();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Gagal membuat pengajuan", "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDecide(id: string, approved: boolean) {
    let rejection_reason: string | undefined;
    if (!approved) {
      rejection_reason = window.prompt("Alasan penolakan?") ?? undefined;
      if (!rejection_reason?.trim()) return;
    }
    setDecidingId(id);
    try {
      const res = await fetch(`/api/hris/loans/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved, rejection_reason }),
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

  const pendingCount = rows.filter((row) => row.status === "pending").length;
  const activeTotal = rows
    .filter((row) => row.status === "approved")
    .reduce((acc, row) => acc + (Number(row.remaining_balance) || 0), 0);

  return (
    <div className="space-y-6 pb-12">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
            <BanknotesIcon className="h-6 w-6 text-pink-600" /> Pinjaman Karyawan
          </h1>
          <p className="text-sm text-gray-500">
            Kasbon & pinjaman — cicilan otomatis terpotong di payroll
            {pendingCount > 0 ? ` · ${pendingCount} menunggu approval` : ""}
            {activeTotal > 0 ? ` · total sisa berjalan ${formatCurrency(activeTotal)}` : ""}
          </p>
        </div>
        <Button className="bg-pink-600 hover:bg-pink-700" onClick={() => setDialog(true)}>
          <PlusIcon className="mr-2 h-4 w-4" /> Pengajuan Baru
        </Button>
      </div>

      <div className="flex items-center gap-3">
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
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200/70 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-4 py-3">Karyawan</th>
              <th className="px-4 py-3">Departemen</th>
              <th className="px-4 py-3">Jenis</th>
              <th className="px-4 py-3">Pokok</th>
              <th className="px-4 py-3">Cicilan/Bulan</th>
              <th className="px-4 py-3">Tenor</th>
              <th className="px-4 py-3">Pelunasan</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} className="py-10 text-center text-gray-400">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-10 text-center text-gray-400">
                  Belum ada pinjaman pada filter ini.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const badge = STATUS_BADGES[row.status] ?? STATUS_BADGES.pending;
                const total = Number(row.paid_amount) + Number(row.remaining_balance);
                const paidPct = total > 0 ? Math.round((Number(row.paid_amount) / total) * 100) : 0;
                return (
                  <tr key={row.id} className="border-b last:border-0 hover:bg-gray-50/60">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {row.employee
                        ? `${row.employee.full_name}${row.employee.nip ? ` - [${row.employee.nip}]` : ""}`
                        : "—"}
                      {row.purpose ? (
                        <p className="max-w-[180px] truncate text-xs font-normal text-gray-400" title={row.purpose}>
                          {row.purpose}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">{row.employee?.department?.name ?? "—"}</td>
                    <td className="px-4 py-3">{loanTypeLabel(row.loan_type)}</td>
                    <td className="px-4 py-3">{formatCurrency(row.principal_amount)}</td>
                    <td className="px-4 py-3">{formatCurrency(row.monthly_installment)}</td>
                    <td className="px-4 py-3">
                      {row.tenor_months} bln
                      {row.first_installment_month
                        ? ` · mulai ${row.first_installment_month}/${row.first_installment_year}`
                        : ""}
                    </td>
                    <td className="px-4 py-3">
                      {row.status === "approved" || row.status === "paid_off" ? (
                        <div className="min-w-[140px]">
                          <div className="mb-1 flex justify-between text-xs text-gray-500">
                            <span>{formatCurrency(row.paid_amount)}</span>
                            <span>{paidPct}%</span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-gray-100">
                            <div
                              className="h-1.5 rounded-full bg-green-500"
                              style={{ width: `${Math.min(100, paidPct)}%` }}
                            />
                          </div>
                          <p className="mt-1 text-xs text-gray-400">
                            Sisa {formatCurrency(row.remaining_balance)}
                          </p>
                        </div>
                      ) : row.status === "rejected" && row.rejection_reason ? (
                        <span className="text-xs text-gray-400">{row.rejection_reason}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.status === "pending" && (
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            disabled={decidingId === row.id}
                            onClick={() => handleDecide(row.id, true)}
                          >
                            Setujui
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={decidingId === row.id}
                            onClick={() => handleDecide(row.id, false)}
                          >
                            Tolak
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

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Pengajuan Pinjaman / Kasbon</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Karyawan</label>
              <Combobox
                options={employeeOptions}
                value={form.employee_id}
                onChange={(value) => setForm((f) => ({ ...f, employee_id: value }))}
                placeholder="Pilih karyawan"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Jenis</label>
              <Combobox
                options={LOAN_TYPE_OPTIONS}
                value={form.loan_type}
                onChange={(value) => setForm((f) => ({ ...f, loan_type: value }))}
                placeholder="Pilih jenis"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Jumlah (Rp)
                </label>
                <Input
                  type="number"
                  min="0"
                  value={form.principal_amount}
                  onChange={(e) => setForm((f) => ({ ...f, principal_amount: e.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Tenor (bulan)
                </label>
                <Input
                  type="number"
                  min="1"
                  max="60"
                  value={form.tenor_months}
                  onChange={(e) => setForm((f) => ({ ...f, tenor_months: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Bunga flat (%/bulan — 0 untuk kasbon)
              </label>
              <Input
                type="number"
                min="0"
                step="0.5"
                value={form.interest_rate}
                onChange={(e) => setForm((f) => ({ ...f, interest_rate: e.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Keperluan</label>
              <Input
                placeholder="cth. biaya sekolah anak"
                value={form.purpose}
                onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))}
              />
            </div>
            {previewInstallment !== null && (
              <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-700">
                Perkiraan cicilan: <strong>{formatCurrency(previewInstallment)}</strong>
                /bulan × {form.tenor_months} bulan. Cicilan mulai terpotong di
                payroll bulan setelah approval. Batas cicilan mengikuti
                pengaturan payroll (default 30% gaji pokok).
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>
              Batal
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Ajukan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

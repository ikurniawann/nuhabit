"use client";

import { useCallback, useEffect, useState } from "react";
import { BanknotesIcon, PlusIcon } from "@heroicons/react/24/outline";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ToastContainer, useToast } from "@/components/ui/toast";

/**
 * ESS → Pinjaman (/dashboard/me/pinjaman): karyawan mengajukan
 * pinjaman/kasbon utk dirinya sendiri + memantau status & pelunasan.
 * Server memaksa employee_id = diri sendiri, bunga 0, status pending.
 */

interface MeData {
  employee: { id: string; full_name: string } | null;
}

interface LoanRow {
  id: string;
  loan_type: string;
  principal_amount: string | number;
  monthly_installment: string | number;
  remaining_balance: string | number;
  paid_amount: string | number;
  tenor_months: number;
  first_installment_month: number | null;
  first_installment_year: number | null;
  status: string;
  purpose: string | null;
  rejection_reason: string | null;
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
  loan_type: "kasbon",
  principal_amount: "",
  tenor_months: "3",
  purpose: "",
};

export function EssPinjamanPage() {
  const { toasts, showToast, removeToast } = useToast();
  const [me, setMe] = useState<MeData | null>(null);
  const [loadingMe, setLoadingMe] = useState(true);
  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [dialog, setDialog] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const loadLoans = useCallback(() => {
    fetch("/api/hris/loans?employee_id=me")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => setLoans(json?.data ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/hris/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => setMe(json?.data ?? null))
      .catch(() => {})
      .finally(() => setLoadingMe(false));
    loadLoans();
  }, [loadLoans]);

  const previewInstallment = (() => {
    const principal = Number(form.principal_amount);
    const tenor = Number(form.tenor_months);
    if (!principal || !tenor) return null;
    return Math.round(principal / tenor);
  })();

  async function handleSubmit() {
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
          loan_type: form.loan_type,
          principal_amount: Number(form.principal_amount),
          tenor_months: Number(form.tenor_months),
          purpose: form.purpose || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Gagal mengajukan pinjaman");
      showToast("Pengajuan pinjaman terkirim — menunggu persetujuan");
      setDialog(false);
      setForm(EMPTY_FORM);
      loadLoans();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Gagal mengajukan pinjaman", "error");
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
          Pengajuan pinjaman hanya tersedia untuk akun yang tertaut ke record
          karyawan HRIS. Hubungi HRD bila menurut Anda ini keliru.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-gray-200/70 pb-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
            <BanknotesIcon className="h-6 w-6 text-pink-600" /> Pinjaman
          </h1>
          <p className="text-sm text-gray-500">
            Ajukan pinjaman/kasbon dan pantau cicilannya
          </p>
        </div>
        <Button className="gap-2" onClick={() => setDialog(true)}>
          <PlusIcon className="h-4 w-4" /> Ajukan Pinjaman
        </Button>
      </div>

      <div className="rounded-xl border border-gray-200/70 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-800">Riwayat Pinjaman</h3>
        {loans.length === 0 ? (
          <p className="mt-4 py-6 text-center text-sm text-gray-400">
            Belum ada pengajuan pinjaman.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-100">
            {loans.map((loan) => {
              const badge = STATUS_BADGES[loan.status] ?? STATUS_BADGES.pending;
              const total = Number(loan.paid_amount) + Number(loan.remaining_balance);
              const paidPct = total > 0 ? Math.round((Number(loan.paid_amount) / total) * 100) : 0;
              return (
                <li key={loan.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">
                        {loanTypeLabel(loan.loan_type)} · {formatCurrency(loan.principal_amount)}
                      </p>
                      <p className="text-xs text-gray-500">
                        Cicilan {formatCurrency(loan.monthly_installment)}/bln × {loan.tenor_months} bln
                        {loan.purpose ? ` · ${loan.purpose}` : ""}
                      </p>
                      {loan.status === "rejected" && loan.rejection_reason && (
                        <p className="mt-0.5 text-xs text-red-500">
                          Alasan ditolak: {loan.rejection_reason}
                        </p>
                      )}
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  </div>
                  {(loan.status === "approved" || loan.status === "paid_off") && (
                    <div className="mt-2">
                      <div className="mb-1 flex justify-between text-xs text-gray-500">
                        <span>Terbayar {formatCurrency(loan.paid_amount)}</span>
                        <span>Sisa {formatCurrency(loan.remaining_balance)}</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-gray-100">
                        <div
                          className="h-1.5 rounded-full bg-green-500"
                          style={{ width: `${Math.min(100, paidPct)}%` }}
                        />
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Ajukan Pinjaman / Kasbon</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
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
                <label className="mb-1 block text-xs font-medium text-gray-600">Jumlah (Rp)</label>
                <Input
                  type="number"
                  min="0"
                  value={form.principal_amount}
                  onChange={(e) => setForm((f) => ({ ...f, principal_amount: e.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Tenor (bulan)</label>
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
              <label className="mb-1 block text-xs font-medium text-gray-600">Keperluan</label>
              <Input
                placeholder="cth. biaya sekolah anak"
                value={form.purpose}
                onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))}
              />
            </div>
            {previewInstallment !== null && (
              <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-700">
                Perkiraan cicilan: <strong>{formatCurrency(previewInstallment)}</strong>/bulan ×{" "}
                {form.tenor_months} bulan (tanpa bunga). Cicilan otomatis
                terpotong dari gaji setelah disetujui HRD.
              </p>
            )}
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

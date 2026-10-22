"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import {
  BanknotesIcon,
  PlusIcon,
  DocumentTextIcon,
  CheckCircleIcon,
  ClockIcon,
  XCircleIcon,
  Cog6ToothIcon,
} from "@heroicons/react/24/outline";
import { useToast, ToastContainer } from "@/components/ui/toast";
import { usePayrollRuns } from "../queries";
import { useAuth } from "@/hooks/use-auth";
import { canDeletePayrollRun } from "@/lib/payroll/roles";
import {
  useCreatePayrollRun,
  useCalculatePayroll,
  useUpdatePayrollStatus,
  useDeletePayrollRun,
} from "../mutations";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  processing: "Processing",
  completed: "Completed",
  paid: "Paid",
  cancelled: "Cancelled",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  processing: "bg-yellow-100 text-yellow-700",
  completed: "bg-blue-100 text-blue-700",
  paid: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
};

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(amount);
}

function getMonthName(month: number): string {
  const months = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
  ];
  return months[month - 1] || "";
}

export function PayrollPage() {
  const router = useRouter();
  const { toasts, showToast, removeToast } = useToast();

  const [showNewDialog, setShowNewDialog] = useState(false);
  const [calculationResult, setCalculationResult] = useState<{count: number, employees: string[]} | null>(null);
  const [showCalcDialog, setShowCalcDialog] = useState<string | null>(null); // ID payroll untuk confirm calculate
  const [includeThr, setIncludeThr] = useState(false);

  const [newPeriodMonth, setNewPeriodMonth] = useState(new Date().getMonth() + 1);
  const [newPeriodYear, setNewPeriodYear] = useState(new Date().getFullYear());

  const payrollQuery = usePayrollRuns();
  const payrollRuns = payrollQuery.data ?? [];
  const loading = payrollQuery.isLoading;

  const createMutation = useCreatePayrollRun();
  const calculateMutation = useCalculatePayroll();
  const updateStatusMutation = useUpdatePayrollStatus();
  const deleteMutation = useDeletePayrollRun();
  const { user } = useAuth();
  // Hapus payroll hanya untuk Super Admin (server juga menolak role lain).
  const canDelete = canDeletePayrollRun(user?.role);

  const creating = createMutation.isPending;
  const calculating = calculateMutation.isPending ? showCalcDialog ?? "calculating" : null;

  async function handleCreatePayroll() {
    try {
      await createMutation.mutateAsync({
        period_month: newPeriodMonth,
        period_year: newPeriodYear,
      });
      setShowNewDialog(false);
      setNewPeriodMonth(new Date().getMonth() + 1);
      setNewPeriodYear(new Date().getFullYear());
      showToast("✅ Payroll run berhasil dibuat", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Gagal membuat payroll", "error");
    }
  }

  async function handleCalculate(runId: string) {
    // Show confirmation dialog instead of calculating directly
    setShowCalcDialog(runId);
  }

  async function confirmCalculate() {
    if (!showCalcDialog) return;
    const runId = showCalcDialog;
    setShowCalcDialog(null);
    try {
      const result = await calculateMutation.mutateAsync({ runId, includeThr });
      setCalculationResult({
        count: result.summary?.total_employees || 0,
        employees: result.summary?.employee_names || [],
      });
      showToast(`Payroll dihitung untuk ${result.summary?.total_employees || 0} karyawan`, "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Gagal menghitung payroll", "error");
    } finally {
      setIncludeThr(false);
    }
  }

  async function handleUpdateStatus(runId: string, newStatus: string) {
    try {
      await updateStatusMutation.mutateAsync({ runId, status: newStatus });
      showToast(`Status diubah ke ${STATUS_LABELS[newStatus]}`, "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Gagal update status", "error");
    }
  }

  async function handleDelete(runId: string) {
    if (!confirm("Apakah Anda yakin ingin menghapus payroll run ini? Data detail payroll juga akan terhapus.")) {
      return;
    }
    try {
      await deleteMutation.mutateAsync(runId);
      showToast("Payroll run berhasil dihapus", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Gagal menghapus payroll", "error");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pink-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Payroll & Benefits</h1>
          <p className="text-sm text-gray-500">Kelola penggajian, slip gaji, dan pinjaman karyawan</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => router.push("/dashboard/hris/payroll/settings")}
          >
            <Cog6ToothIcon className="w-4 h-4 mr-2" />
            Pengaturan
          </Button>
          <Button onClick={() => setShowNewDialog(true)} className="bg-pink-600 hover:bg-pink-700">
            <PlusIcon className="w-4 h-4 mr-2" />
            Payroll Baru
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-500">Total Payroll Runs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{payrollRuns.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-500">Dalam Draft</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {payrollRuns.filter(r => r.status === "draft").length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-500">Completed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {payrollRuns.filter(r => r.status === "completed").length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-500">Paid</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {payrollRuns.filter(r => r.status === "paid").length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Payroll Runs Table */}
      <Card>
        <CardHeader>
          <CardTitle>Riwayat Payroll</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-medium text-gray-500">Periode</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-500">Nama</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-500">Status</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-500">Karyawan</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-500">Total Gross</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-500">Total Net</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-500">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {payrollRuns.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-gray-500">
                      Belum ada payroll run. Klik &quot;Payroll Baru&quot; untuk membuat.
                    </td>
                  </tr>
                ) : (
                  payrollRuns.map((run) => (
                    <tr key={run.id} className="border-b hover:bg-gray-50">
                      <td className="py-3 px-4">
                        {getMonthName(run.period_month)} {run.period_year}
                      </td>
                      <td className="py-3 px-4">{run.run_name}</td>
                      <td className="py-3 px-4">
                        <Badge className={STATUS_COLORS[run.status]}>
                          {STATUS_LABELS[run.status]}
                        </Badge>
                      </td>
                      <td className="text-right py-3 px-4">{run.total_employees || 0}</td>
                      <td className="text-right py-3 px-4 font-medium">
                        {formatCurrency(run.total_gross || 0)}
                      </td>
                      <td className="text-right py-3 px-4 font-medium text-green-600">
                        {formatCurrency(run.total_net || 0)}
                      </td>
                      <td className="text-right py-3 px-4">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => router.push(`/dashboard/hris/payroll/${run.id}`)}
                          >
                            <DocumentTextIcon className="w-4 h-4" />
                          </Button>
                          {run.status === "draft" && (
                            <>
                              <Button
                                size="sm"
                                onClick={() => handleCalculate(run.id)}
                                className="bg-blue-600 hover:bg-blue-700"
                              >
                                Calculate
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => handleUpdateStatus(run.id, "processing")}
                                style={{ backgroundColor: '#ea580c', color: 'white' }}
                              >
                                Process
                              </Button>
                            </>
                          )}
                          {run.status === "processing" && (
                            <Button
                              size="sm"
                              onClick={() => handleUpdateStatus(run.id, "completed")}
                              className="bg-green-600 hover:bg-green-700"
                            >
                              Approve
                            </Button>
                          )}
                          {run.status === "completed" && (
                            <Button
                              size="sm"
                              onClick={() => handleUpdateStatus(run.id, "paid")}
                              className="bg-green-600 hover:bg-green-700"
                            >
                              Mark Paid
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDelete(run.id)}
                              className="text-red-600 hover:text-red-700 hover:border-red-300"
                            >
                              Hapus
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* New Payroll Dialog */}
      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Buat Payroll Baru</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bulan</label>
              <Select value={String(newPeriodMonth)} onValueChange={(v) => setNewPeriodMonth(parseInt(v))}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih bulan" />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {getMonthName(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tahun</label>
              <Input
                type="number"
                value={newPeriodYear}
                onChange={(e) => setNewPeriodYear(parseInt(e.target.value))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewDialog(false)}>
              Batal
            </Button>
            <Button
              onClick={handleCreatePayroll}
              disabled={creating}
              className="bg-pink-600 hover:bg-pink-700"
            >
              {creating ? "Membuat..." : "Buat Payroll"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Calculation Loading/Result Modal */}
      <Dialog open={calculating !== null || calculationResult !== null} onOpenChange={(open) => {
        if (!open) {
          setCalculationResult(null);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {calculating ? "Menghitung Payroll..." : "Hasil Perhitungan"}
            </DialogTitle>
          </DialogHeader>
          
          {calculating ? (
            <div className="py-8 flex flex-col items-center justify-center space-y-4">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-pink-600" />
              <p className="text-gray-600">Sedang menghitung payroll untuk semua karyawan...</p>
            </div>
          ) : calculationResult ? (
            <div className="py-4 space-y-4">
              <div className="flex items-center justify-center space-x-2 text-green-600">
                <CheckCircleIcon className="w-8 h-8" />
                <span className="text-lg font-semibold">Perhitungan Berhasil!</span>
              </div>
              
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="text-sm text-gray-600 mb-2">Karyawan yang dihitung:</p>
                <p className="text-2xl font-bold text-green-700">{calculationResult.count} Karyawan</p>
                
                {calculationResult.employees && calculationResult.employees.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {calculationResult.employees.map((name, idx) => (
                      <div key={idx} className="text-sm text-gray-700 flex items-center">
                        <CheckCircleIcon className="w-4 h-4 mr-2 text-green-600" />
                        {name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              
              <div className="flex justify-end pt-4">
                <Button
                  onClick={() => {
                    setCalculationResult(null);
                  }}
                  className="bg-pink-600 hover:bg-pink-700"
                >
                  Tutup
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Calculate Confirmation Dialog */}
      <Dialog open={showCalcDialog !== null} onOpenChange={(open) => {
        if (!open) {
          setShowCalcDialog(null);
          setIncludeThr(false);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Konfirmasi Perhitungan Payroll</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <p className="text-sm text-gray-600">
              Apakah Anda yakin ingin menghitung payroll untuk periode ini?
            </p>
            
            <div className="flex items-center space-x-2 border rounded-lg p-3 bg-gray-50">
              <input
                type="checkbox"
                id="include-thr"
                checked={includeThr}
                onChange={(e) => setIncludeThr(e.target.checked)}
                className="h-4 w-4 text-pink-600 focus:ring-pink-500 border-gray-300 rounded"
              />
              <label htmlFor="include-thr" className="text-sm font-medium text-gray-700 cursor-pointer">
                Include THR (Tunjangan Hari Raya)
              </label>
            </div>
            
            {includeThr && (
              <div className="text-xs text-gray-500 bg-yellow-50 border border-yellow-200 rounded p-2">
                ℹ️ THR akan ditambahkan sebesar 1x gaji pokok untuk karyawan yang sudah bekerja ≥ 1 tahun
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowCalcDialog(null);
                setIncludeThr(false);
              }}
            >
              Batal
            </Button>
            <Button
              onClick={confirmCalculate}
              className="bg-blue-600 hover:bg-blue-700"
            >
              Hitung Payroll
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

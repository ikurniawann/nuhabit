"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PlusIcon, DocumentTextIcon, Cog6ToothIcon } from "@heroicons/react/24/outline";
import { toast } from "sonner";
import { formatRupiah } from "@/lib/format";
import { monthName } from "@/lib/hris/month-label";
import { usePayrollRuns } from "../queries";
import { useCalculatePayroll, useUpdatePayrollStatus, useDeletePayrollRun } from "../mutations";
import {
  CalculateConfirmDialog,
  CalculationResultDialog,
  NewPayrollDialog,
  type CalculationResult,
} from "./payroll-run-dialogs";

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

export function PayrollPage() {
  const router = useRouter();
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [calcRunId, setCalcRunId] = useState<string | null>(null);
  const [calculationResult, setCalculationResult] = useState<CalculationResult | null>(null);

  const payrollQuery = usePayrollRuns();
  const payrollRuns = payrollQuery.data ?? [];
  const loading = payrollQuery.isLoading;

  const calculateMutation = useCalculatePayroll();
  const updateStatusMutation = useUpdatePayrollStatus();
  const deleteMutation = useDeletePayrollRun();

  function confirmCalculate(includeThr: boolean) {
    if (!calcRunId) return;
    const runId = calcRunId;
    setCalcRunId(null);
    calculateMutation.mutate(
      { runId, includeThr },
      {
        onSuccess: (result) => {
          setCalculationResult({
            count: result.summary?.total_employees || 0,
            employees: result.summary?.employee_names || [],
          });
          toast.success(`Payroll dihitung untuk ${result.summary?.total_employees || 0} karyawan`);
        },
        onError: (error) => toast.error(error.message || "Gagal menghitung payroll"),
      }
    );
  }

  async function handleUpdateStatus(runId: string, newStatus: string) {
    try {
      await updateStatusMutation.mutateAsync({ runId, status: newStatus });
      toast.success(`Status diubah ke ${STATUS_LABELS[newStatus]}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal update status");
    }
  }

  async function handleDelete(runId: string) {
    if (!confirm("Apakah Anda yakin ingin menghapus payroll run ini? Data detail payroll juga akan terhapus.")) {
      return;
    }
    try {
      await deleteMutation.mutateAsync(runId);
      toast.success("Payroll run berhasil dihapus");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menghapus payroll");
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
                        {monthName(run.period_month)} {run.period_year}
                      </td>
                      <td className="py-3 px-4">{run.run_name}</td>
                      <td className="py-3 px-4">
                        <Badge className={STATUS_COLORS[run.status]}>
                          {STATUS_LABELS[run.status]}
                        </Badge>
                      </td>
                      <td className="text-right py-3 px-4">{run.total_employees || 0}</td>
                      <td className="text-right py-3 px-4 font-medium">
                        {formatRupiah(run.total_gross || 0)}
                      </td>
                      <td className="text-right py-3 px-4 font-medium text-green-600">
                        {formatRupiah(run.total_net || 0)}
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
                                onClick={() => setCalcRunId(run.id)}
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
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleDelete(run.id)}
                            className="text-red-600 hover:text-red-700 hover:border-red-300"
                          >
                            Hapus
                          </Button>
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

      <NewPayrollDialog open={showNewDialog} onOpenChange={setShowNewDialog} />
      <CalculationResultDialog
        calculating={calculateMutation.isPending}
        result={calculationResult}
        onClose={() => setCalculationResult(null)}
      />
      <CalculateConfirmDialog
        open={calcRunId !== null}
        onCancel={() => setCalcRunId(null)}
        onConfirm={confirmCalculate}
      />
    </div>
  );
}

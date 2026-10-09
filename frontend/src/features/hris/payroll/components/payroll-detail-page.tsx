"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowLeftIcon,
  DocumentTextIcon,
  ArrowDownTrayIcon,
} from "@heroicons/react/24/outline";
import { toast } from "sonner";
import { formatRupiah } from "@/lib/format";
import { monthName } from "@/lib/hris/month-label";
import { usePayrollRun } from "../queries";
import { useNotifyPayslip } from "../mutations";

interface PayrollPageProps {
  params: Promise<{ id: string }>;
}

export function PayrollDetailPage({ params }: PayrollPageProps) {
  const { id } = use(params);
  const router = useRouter();
  const runQuery = usePayrollRun(id);
  const payrollRun = runQuery.data ?? null;
  const details = payrollRun?.payroll_details ?? [];
  const loading = runQuery.isLoading;
  const notify = useNotifyPayslip(id);
  const [exporting, setExporting] = useState(false);
  const notifyingId = notify.isPending ? notify.variables : null;
  const missingEmailCount = details.filter((detail) => !detail.employee?.is_active || !detail.employee?.email).length;
  const emailedCount = details.filter((detail) => Boolean(detail.payslip_emailed_at)).length;

  function handleNotify(detailId: string, alreadyEmailed: boolean) {
    if (alreadyEmailed && !window.confirm("Kirim ulang slip gaji ke email karyawan ini?")) return;
    notify.mutate(detailId, {
      onSuccess: (json) => {
        toast.success(json.message || "Email slip gaji diterima Resend");
      },
      onError: (error) => toast.error(error.message || "Gagal mengirim notifikasi"),
    });
  }

  async function handleExportPayroll() {
    if (details.length === 0) {
      toast.error("Tidak ada data untuk diekspor");
      return;
    }
    if (!payrollRun) return;
    setExporting(true);
    try {
      const { buildPayrollRunWorkbook } = await import("@/lib/payroll/ui-run-workbook");
      const workbook = await buildPayrollRunWorkbook(payrollRun);
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `nuhabit-payroll-${payrollRun.period_year}-${String(payrollRun.period_month).padStart(2, "0")}-draf.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Draf payroll XLSX berhasil diunduh");
    } catch {
      toast.error("Gagal membuat draf payroll XLSX");
    } finally {
      setExporting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pink-600" />
      </div>
    );
  }

  if (!payrollRun) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900">Payroll tidak ditemukan</h2>
        <Button variant="outline" className="mt-4" onClick={() => router.push("/dashboard/hris/payroll")}>
          <ArrowLeftIcon className="w-4 h-4 mr-2" />
          Kembali
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.push("/dashboard/hris/payroll")}>
          <ArrowLeftIcon className="w-4 h-4 mr-1" />
          Kembali
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">{payrollRun.run_name}</h1>
          <p className="text-sm text-gray-500">
            {monthName(payrollRun.period_month)} {payrollRun.period_year} • {payrollRun.total_employees} karyawan
          </p>
        </div>
        <Button onClick={() => void handleExportPayroll()} variant="outline" disabled={exporting}>
          <ArrowDownTrayIcon className="w-4 h-4 mr-2" />
          {exporting ? "Membuat XLSX…" : "Export XLSX (Draf)"}
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-500">Total Gross</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-gray-900">
              {formatRupiah(payrollRun.total_gross)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-500">Total Potongan</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {formatRupiah(payrollRun.total_deductions)}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              PPh 21: {formatRupiah(payrollRun.total_pph21)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-500">Total Net (Take Home Pay)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {formatRupiah(payrollRun.total_net)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-500">Employer BPJS</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-blue-600">
              {formatRupiah(payrollRun.total_bjtk_employer)}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Employee: {formatRupiah(payrollRun.total_bjtk_employee)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Employee Details Table */}
      <Card>
        <CardHeader>
          <CardTitle>Detail Payroll per Karyawan</CardTitle>
          {details.length > 0 ? (
            <p className="text-sm text-gray-600">
              {details.length - missingEmailCount} dari {details.length} karyawan aktif memiliki alamat email.
              {payrollRun.status === "paid" ? ` ${emailedCount} slip diterima Resend.` : ""}
              {missingEmailCount > 0 ? ` ${missingEmailCount} perlu diperiksa HR sebelum slip dikirim.` : ""}
            </p>
          ) : null}
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-medium text-gray-500">Karyawan</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-500">Departemen</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-500">Gaji Kotor</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-500">Potongan</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-500">Gaji Bersih</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-500">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {details.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-gray-500">
                      Belum ada detail payroll. Klik &quot;Calculate&quot; di halaman sebelumnya.
                    </td>
                  </tr>
                ) : (
                  details.map((detail) => (
                    <tr key={detail.id} className="border-b hover:bg-gray-50">
                      <td className="py-3 px-4">
                        <div>
                          <div className="font-medium">{detail.employee?.full_name}</div>
                          <div className="text-xs text-gray-500">{detail.employee?.nip}</div>
                          <div className={`text-xs ${detail.employee?.is_active && detail.employee?.email ? "text-gray-500" : "text-red-700"}`}>
                            {detail.employee?.is_active && detail.employee?.email ? detail.employee.email : "Email karyawan belum siap"}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {detail.employee?.department?.name || "-"}
                      </td>
                      <td className="text-right py-3 px-4 font-medium">
                        {formatRupiah(detail.gross_salary)}
                      </td>
                      <td className="text-right py-3 px-4 text-red-600">
                        {formatRupiah(detail.total_deductions)}
                      </td>
                      <td className="text-right py-3 px-4 font-medium text-green-600">
                        {formatRupiah(detail.net_salary)}
                      </td>
                      <td className="text-right py-3 px-4">
                        <div className="flex items-center justify-end gap-2">
                          {payrollRun?.status === "paid" && (
                            <Button
                              size="sm"
                              variant={detail.payslip_emailed_at ? "ghost" : "outline"}
                              className={detail.payslip_emailed_at ? "text-green-600" : ""}
                              disabled={notifyingId === detail.id || !detail.employee?.is_active || !detail.employee?.email}
                              title={
                                !detail.employee?.is_active || !detail.employee?.email
                                  ? "Aktifkan dan lengkapi email karyawan sebelum mengirim slip"
                                  : detail.payslip_emailed_at
                                  ? `Diterima Resend untuk ${detail.payslip_email_recipient ?? detail.employee.email} — klik untuk kirim ulang`
                                  : "Kirim PDF slip gaji ke email karyawan"
                              }
                              onClick={() => handleNotify(detail.id, Boolean(detail.payslip_emailed_at))}
                            >
                              {detail.payslip_emailed_at ? "✓ Email" : "Email"}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => router.push(`/dashboard/hris/payroll/${id}/payslip/${detail.employee_id}`)}
                          >
                            <DocumentTextIcon className="w-4 h-4" />
                            Slip
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
    </div>
  );
}

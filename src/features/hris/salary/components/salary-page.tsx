"use client";

import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PlusIcon, PencilIcon } from "@heroicons/react/24/outline";
import { useToast, ToastContainer } from "@/components/ui/toast";
import { useSalaryList } from "../queries";

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(amount);
}

export function SalaryPage() {
  const router = useRouter();
  const { toasts, removeToast } = useToast();

  const salaryQuery = useSalaryList();
  const salaries = salaryQuery.data ?? [];
  const loading = salaryQuery.isLoading;

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
          <h1 className="text-2xl font-bold text-gray-900">Salary Structure</h1>
          <p className="text-sm text-gray-500">Kelola struktur gaji karyawan</p>
        </div>
        <Button onClick={() => router.push('/dashboard/hris/salary/insert')} className="bg-pink-600 hover:bg-pink-700">
          <PlusIcon className="w-4 h-4 mr-2" />
          Tambah Salary
        </Button>
      </div>

      {/* Salary Table */}
      <Card>
        <CardHeader>
          <CardTitle>Daftar Salary Structure</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-medium text-gray-500">Karyawan</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-500">Gaji Pokok</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-500">Tunjangan Tetap</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-500">Transport</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-500">Makan</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-500">Status PTKP</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-500">Efektif</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-500">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {salaries.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-gray-500">
                      Belum ada salary structure. Klik &quot;Tambah Salary&quot; untuk membuat.
                    </td>
                  </tr>
                ) : (
                  salaries.map((salary) => (
                    <tr key={salary.id} className="border-b hover:bg-gray-50">
                      <td className="py-3 px-4">
                        <div>
                          <div className="font-medium">{salary.employee?.full_name}</div>
                          <div className="text-xs text-gray-500">{salary.employee?.nip}</div>
                        </div>
                      </td>
                      <td className="text-right py-3 px-4 font-medium">
                        {formatCurrency(salary.base_salary)}
                      </td>
                      <td className="text-right py-3 px-4">
                        {formatCurrency(salary.fixed_allowance)}
                      </td>
                      <td className="text-right py-3 px-4">
                        {formatCurrency(salary.transport_allowance)}
                      </td>
                      <td className="text-right py-3 px-4">
                        {formatCurrency(salary.meal_allowance)}
                      </td>
                      <td className="py-3 px-4">
                        <Badge>{salary.ptkp_status}</Badge>
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-500">
                        {new Date(salary.effective_date).toLocaleDateString("id-ID")}
                      </td>
                      <td className="text-right py-3 px-4">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => router.push(`/dashboard/hris/salary/${salary.id}`)}
                        >
                          <PencilIcon className="w-4 h-4" />
                        </Button>
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

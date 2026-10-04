"use client";

import { useState } from "react";
import { BanknotesIcon, DocumentTextIcon } from "@heroicons/react/24/outline";
import { formatRupiah } from "@/lib/format";
import { useEssMe, useMyPayslips } from "../queries";
import type { EssPayslip } from "../types";
import { EssLoading, EssNotLinked } from "./ess-states";
import { PayslipDetailDialog, payslipPeriodLabel } from "./payslip-detail-dialog";

/**
 * ESS → Slip Gaji (/dashboard/me/slip-gaji): karyawan melihat slip gajinya
 * SENDIRI dari run payroll yang sudah dibayar (di-enforce server di
 * /api/hris/payslips). EPIC-008 Fase E.
 */
export function EssSlipGajiPage() {
  const meQuery = useEssMe();
  const slipsQuery = useMyPayslips();
  const slips = slipsQuery.data ?? [];
  const [selected, setSelected] = useState<EssPayslip | null>(null);

  if (meQuery.isLoading || slipsQuery.isLoading) return <EssLoading />;
  if (!meQuery.data?.employee) return <EssNotLinked feature="Slip gaji" />;

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200/70 pb-4">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
          <BanknotesIcon className="h-6 w-6 text-pink-600" /> Slip Gaji
        </h1>
        <p className="text-sm text-gray-500">
          Slip gaji Anda dari periode yang sudah dibayarkan
        </p>
      </div>

      {slips.length === 0 ? (
        <div className="rounded-xl border border-gray-200/70 bg-white p-10 text-center shadow-sm">
          <DocumentTextIcon className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">
            Belum ada slip gaji yang terbit. Slip muncul di sini setelah
            payroll periode berjalan dibayarkan.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {slips.map((slip) => (
            <li key={slip.id}>
              <button
                type="button"
                onClick={() => setSelected(slip)}
                className="w-full rounded-xl border border-gray-200/70 bg-white p-5 text-left shadow-sm transition hover:border-pink-300 hover:shadow"
              >
                <p className="text-sm font-semibold text-gray-800">{payslipPeriodLabel(slip)}</p>
                <p className="mt-2 text-2xl font-bold text-gray-900">
                  {formatRupiah(slip.net_salary)}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  Take home pay · bruto {formatRupiah(slip.gross_salary)}
                </p>
                <p className="mt-2 text-xs text-gray-400">
                  {slip.present_days}/{slip.working_days} hari hadir
                  {Number(slip.overtime_hours) > 0 ? ` · lembur ${Number(slip.overtime_hours)} jam` : ""}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}

      <PayslipDetailDialog selected={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

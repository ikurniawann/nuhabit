"use client";

import Link from "next/link";
import {
  ExclamationTriangleIcon,
  ClockIcon,
  DocumentMinusIcon,
} from "@heroicons/react/24/outline";
import { useExpiringContracts } from "../queries";

/**
 * Banner pengingat kontrak: (1) kontrak aktif yang akan/telah lewat tanggal
 * berakhir (≤30 hari), (2) masa percobaan PKWTT yang akan berakhir, dan
 * (3) karyawan aktif tanpa kontrak aktif — PKWT wajib tertulis sebelum mulai
 * bekerja (PP 35/2021). Klik nama → tab Kontrak di detail karyawan.
 */

function daysLabel(daysLeft: number): string {
  if (daysLeft < 0) return `lewat ${Math.abs(daysLeft)} hari`;
  if (daysLeft === 0) return "hari ini";
  return `${daysLeft} hari lagi`;
}

export function ContractExpiryBanner() {
  const { data } = useExpiringContracts(30);
  if (
    !data ||
    (data.contracts.length === 0 &&
      data.probations.length === 0 &&
      (data.noContract?.length ?? 0) === 0)
  ) {
    return null;
  }

  return (
    <div className="space-y-2">
      {(data.noContract?.length ?? 0) > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-red-800">
            <DocumentMinusIcon className="h-4 w-4" />
            {data.noContract.length} karyawan aktif tanpa kontrak aktif
          </p>
          <p className="mt-0.5 text-xs text-red-700">
            PKWT wajib tertulis sebelum karyawan mulai bekerja (PP 35/2021) — aktifkan
            draft atau buat kontraknya.
          </p>
          <ul className="mt-2 space-y-1">
            {data.noContract.map((item) => (
              <li key={item.employee_id} className="text-sm text-red-800">
                <Link
                  href={`/dashboard/employees/${item.employee_id}?tab=contracts`}
                  className="font-medium text-red-900 underline-offset-2 hover:underline"
                >
                  {item.employee_name}
                </Link>{" "}
                ({item.employment_status}) —{" "}
                {item.draft_contract_number
                  ? `draft ${item.draft_contract_number} belum diaktifkan`
                  : "belum ada kontrak sama sekali"}
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.contracts.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-amber-800">
            <ExclamationTriangleIcon className="h-4 w-4" />
            {data.contracts.length} kontrak akan berakhir dalam {data.days} hari
          </p>
          <ul className="mt-2 space-y-1">
            {data.contracts.map((item) => {
              const urgent = item.days_left <= 14;
              return (
                <li key={item.contract_id} className="text-sm">
                  <Link
                    href={`/dashboard/employees/${item.employee_id}?tab=contracts`}
                    className="font-medium text-amber-900 underline-offset-2 hover:underline"
                  >
                    {item.employee_name}
                  </Link>{" "}
                  <span className="text-amber-800">
                    — {item.contract_number} ({item.contract_type.toUpperCase()}
                    {item.position_title ? ` · ${item.position_title}` : ""}) berakhir{" "}
                  </span>
                  <span className={urgent ? "font-semibold text-red-600" : "text-amber-800"}>
                    {daysLabel(item.days_left)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {data.probations.length > 0 && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-sky-800">
            <ClockIcon className="h-4 w-4" />
            {data.probations.length} masa percobaan akan berakhir dalam {data.days} hari
          </p>
          <ul className="mt-2 space-y-1">
            {data.probations.map((item) => (
              <li key={item.contract_id} className="text-sm text-sky-800">
                <Link
                  href={`/dashboard/employees/${item.employee_id}?tab=contracts`}
                  className="font-medium text-sky-900 underline-offset-2 hover:underline"
                >
                  {item.employee_name}
                </Link>{" "}
                — {item.contract_number}
                {item.position_title ? ` · ${item.position_title}` : ""} — probation selesai{" "}
                <span className="font-semibold">{daysLabel(item.days_left)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

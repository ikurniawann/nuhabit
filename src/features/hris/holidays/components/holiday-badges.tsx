import type { ReactNode } from "react";
import type { HolidayType } from "@/lib/hris/holidays";
import type { HolidayStatus } from "@/lib/hris/holidays-view";

export const HOLIDAY_TYPE_META: Record<HolidayType, { label: string; className: string }> = {
  nasional: { label: "Libur Nasional", className: "bg-red-50 text-red-600 ring-red-100" },
  cuti_bersama: { label: "Cuti Bersama", className: "bg-amber-50 text-amber-700 ring-amber-100" },
  perusahaan: { label: "Libur Perusahaan", className: "bg-sky-50 text-sky-700 ring-sky-100" },
};

interface HolidayBadgesProps {
  type: HolidayType;
  deductsLeave: boolean;
  status: HolidayStatus;
  children?: ReactNode;
}

/** Badge tipe, potong cuti, dan draft; dipakai kartu bulan dan pratinjau impor. */
export function HolidayBadges({ type, deductsLeave, status, children }: HolidayBadgesProps) {
  const meta = HOLIDAY_TYPE_META[type];
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ${meta.className}`}>
        {meta.label}
      </span>
      {deductsLeave && (
        <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">
          memotong jatah cuti
        </span>
      )}
      {status === "draft" && (
        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
          Draft
        </span>
      )}
      {children}
    </div>
  );
}

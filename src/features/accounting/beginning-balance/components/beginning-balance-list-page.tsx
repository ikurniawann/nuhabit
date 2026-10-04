"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { BanknotesIcon } from "@heroicons/react/24/outline";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { useFiscalYearList } from "@/features/accounting/fiscal-years/queries";
import { FISCAL_YEAR_ROUTES } from "@/features/accounting/fiscal-years/routes";
import { BEGINNING_BALANCE_ROUTES } from "../routes";

export function BeginningBalanceListPage() {
  const router = useRouter();
  const { data, isLoading } = useFiscalYearList({ is_active: "true" });
  const rows = useMemo(() => data ?? [], [data]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Beginning Balance
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Saldo awal per fiscal year — suggest dari FY sebelumnya, bisa diedit
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push(FISCAL_YEAR_ROUTES.new)}
          className="h-10 rounded-lg border-gray-200/80"
        >
          Buat Fiscal Year
        </Button>
      </div>

      <PurchasingListSection
        icon={BanknotesIcon}
        title="Pilih Fiscal Year"
        description="Buka saldo awal untuk fiscal year yang ingin dikonfigurasi."
      >
        {isLoading ? (
          <div className="py-14 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand-text" />
            <p className="mt-2 text-sm text-muted-foreground">
              Memuat fiscal years...
            </p>
          </div>
        ) : rows.length === 0 ? (
          <div className="py-14 text-center">
            <p className="text-muted-foreground">
              Belum ada fiscal year aktif. Buat fiscal year terlebih dahulu.
            </p>
            <Button
              type="button"
              onClick={() => router.push(FISCAL_YEAR_ROUTES.new)}
              className="mt-4 h-10 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Tambah Fiscal Year
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto px-4">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-gray-200/70 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-3">Kode</th>
                  <th className="px-3 py-3">Nama</th>
                  <th className="px-3 py-3">Periode</th>
                  <th className="px-3 py-3">Open periods</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-gray-200/70 last:border-0 hover:bg-muted/40"
                  >
                    <td className="px-3 py-3 font-medium text-foreground">
                      {row.code}
                    </td>
                    <td className="px-3 py-3 text-foreground">{row.name}</td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {row.start_date} → {row.end_date}
                    </td>
                    <td className="px-3 py-3">
                      {row.open_periods_count}/{row.periods.length}
                    </td>
                    <td className="px-3 py-3">
                      <Badge
                        variant={row.is_active ? "default" : "secondary"}
                        className="font-normal"
                      >
                        {row.is_active ? "Aktif" : "Nonaktif"}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() =>
                          router.push(
                            BEGINNING_BALANCE_ROUTES.forFiscalYear(row.id),
                          )
                        }
                        className="h-8 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
                      >
                        Kelola Saldo Awal
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PurchasingListSection>
    </div>
  );
}

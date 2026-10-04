"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDaysIcon } from "@heroicons/react/24/outline";
import { Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { useFiscalYearList } from "@/features/accounting/fiscal-years/queries";
import { useOpenAccountingPeriod } from "../mutations";
import { useAccountingPeriods } from "../queries";
import { PERIOD_ROUTES } from "../routes";
import type { AccountingPeriodListItem } from "../types";
import { useDebouncedSearch } from "@/features/accounting/shared/use-debounced-search";

export function AccountingPeriodPage() {
  const router = useRouter();
  const { query: searchQuery, setQuery: setSearchQuery, search } = useDebouncedSearch();
  const [fiscalYearId, setFiscalYearId] = useState("");
  const [status, setStatus] = useState<"" | "OPEN" | "CLOSED">("");
  const [openTarget, setOpenTarget] =
    useState<AccountingPeriodListItem | null>(null);


  const yearsQuery = useFiscalYearList({ is_active: "true" });
  const yearOptions = useMemo(
    () =>
      (yearsQuery.data ?? []).map((y) => ({
        value: y.id,
        label: `${y.code} — ${y.name}`,
      })),
    [yearsQuery.data]
  );

  const { data, isLoading } = useAccountingPeriods({
    search: search || undefined,
    fiscal_year_id: fiscalYearId || undefined,
    status: status || undefined,
  });
  const rows = data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Accounting Period
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Kelola status OPEN/CLOSED per bulan. Soft close — tanpa jurnal
            penutup.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push(PERIOD_ROUTES.fiscalYears)}
          className="h-10 rounded-lg border-gray-200/80"
        >
          Kelola Fiscal Years
        </Button>
      </div>

      <PurchasingListSection
        icon={CalendarDaysIcon}
        title="Daftar Periode"
        description="Hanya fiscal year aktif. Tutup period lewat Period Closing jika ada draft jurnal."
        toolbar={
          <div className="flex w-full flex-col gap-2 lg:flex-row lg:items-center">
            <label className="relative min-w-[180px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Cari period / FY..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 bg-card pl-9 pr-9 text-sm focus:border-primary/40 focus:ring-1 focus:ring-primary/30"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  aria-label="Clear"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </label>
            <Combobox
              options={yearOptions}
              value={fiscalYearId}
              onChange={setFiscalYearId}
              placeholder="Semua FY"
              searchPlaceholder="Cari FY..."
              allowClear
              className="h-10 w-full bg-card lg:w-56"
            />
            <Combobox
              options={[
                { value: "OPEN", label: "OPEN" },
                { value: "CLOSED", label: "CLOSED" },
              ]}
              value={status}
              onChange={(v) => setStatus((v as "" | "OPEN" | "CLOSED") || "")}
              placeholder="Semua status"
              searchPlaceholder="Cari..."
              allowClear
              className="h-10 w-full bg-card lg:w-40"
            />
          </div>
        }
      >
        {isLoading ? (
          <div className="py-14 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand-text" />
          </div>
        ) : rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            Belum ada period. Buat Fiscal Year terlebih dahulu.
          </p>
        ) : (
          <div className="overflow-x-auto px-4">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-gray-200/70 text-left text-muted-foreground">
                  <th className="px-2 py-3 font-medium">FY</th>
                  <th className="px-2 py-3 font-medium">Period</th>
                  <th className="px-2 py-3 font-medium">Tanggal</th>
                  <th className="px-2 py-3 font-medium">Status</th>
                  <th className="px-2 py-3 font-medium text-right">Posted</th>
                  <th className="px-2 py-3 font-medium text-right">Draft</th>
                  <th className="px-2 py-3 font-medium text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-gray-200/70 hover:bg-muted/40"
                  >
                    <td className="px-2 py-3">
                      <span className="font-medium">{row.fiscal_year_code}</span>
                    </td>
                    <td className="px-2 py-3">
                      <span className="text-muted-foreground">
                        #{row.period_no}
                      </span>{" "}
                      {row.name}
                    </td>
                    <td className="px-2 py-3 text-muted-foreground">
                      {row.start_date} → {row.end_date}
                    </td>
                    <td className="px-2 py-3">
                      <Badge
                        variant="outline"
                        className={
                          row.status === "OPEN"
                            ? "border-primary/30 text-brand-text"
                            : "border-gray-200/80 text-muted-foreground"
                        }
                      >
                        {row.status}
                      </Badge>
                    </td>
                    <td className="px-2 py-3 text-right tabular-nums">
                      {row.posted_count}
                    </td>
                    <td className="px-2 py-3 text-right tabular-nums">
                      {row.draft_count > 0 ? (
                        <span className="text-amber-700 dark:text-amber-500">
                          {row.draft_count}
                        </span>
                      ) : (
                        row.draft_count
                      )}
                    </td>
                    <td className="px-2 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        {row.status === "CLOSED" ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 rounded-lg border-gray-200/80"
                            onClick={() => setOpenTarget(row)}
                          >
                            Buka
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 rounded-lg border-gray-200/80"
                            onClick={() =>
                              router.push(
                                PERIOD_ROUTES.closingWithPeriod(row.id)
                              )
                            }
                          >
                            Tutup
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PurchasingListSection>

      <OpenPeriodDialog
        period={openTarget}
        onOpenChange={(open) => {
          if (!open) setOpenTarget(null);
        }}
      />
    </div>
  );
}

function OpenPeriodDialog({
  period,
  onOpenChange,
}: {
  period: AccountingPeriodListItem | null;
  onOpenChange: (open: boolean) => void;
}) {
  const mutation = useOpenAccountingPeriod();
  const open = Boolean(period);

  async function handleOpen() {
    if (!period || mutation.isPending) return;
    try {
      const res = await mutation.mutateAsync({
        periodId: period.id,
        close_previous: true,
      });
      toast.success(res.message || `Period ${period.name} dibuka`);
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Gagal membuka period"
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPanel size="xs">
        <DialogPanelHeader>
          <DialogPanelTitle>Buka Period</DialogPanelTitle>
          <DialogPanelDescription>
            {period
              ? `Buka ${period.name} (${period.fiscal_year_code}). Period OPEN sebelumnya di FY yang sama akan ditutup otomatis.`
              : ""}
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody>
          <p className="text-sm text-muted-foreground">
            Soft open — tidak mengubah jurnal existing.
          </p>
        </DialogPanelBody>
        <DialogFooter className="gap-3 px-6 py-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Batal
          </Button>
          <Button
            type="button"
            onClick={handleOpen}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Membuka...
              </>
            ) : (
              "Buka Period"
            )}
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}

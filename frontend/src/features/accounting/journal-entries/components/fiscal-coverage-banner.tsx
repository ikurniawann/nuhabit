"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useOpenFiscalPeriod } from "@/features/accounting/fiscal-years/mutations";
import { FISCAL_YEAR_ROUTES } from "@/features/accounting/fiscal-years/routes";
import type { FiscalCoverageResult } from "@/lib/accounting/fiscal-types";

/** Peringatan tanggal jurnal tanpa fiscal period OPEN + aksi buka period yang disarankan. */
export function FiscalCoverageBanner({
  entryDate,
  suggestion,
  readOnly,
}: {
  entryDate: string;
  suggestion: FiscalCoverageResult["suggestion"];
  readOnly: boolean;
}) {
  const openPeriodMutation = useOpenFiscalPeriod();
  return (
    <div className="mb-4 space-y-3 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-foreground">
      {suggestion ? (
        <>
          <p>{suggestion.message}</p>
          <div className="flex flex-wrap items-center gap-2">
            {suggestion.can_open ? (
              <Button
                type="button"
                size="sm"
                disabled={openPeriodMutation.isPending || readOnly}
                onClick={async () => {
                  try {
                    const res = await openPeriodMutation.mutateAsync({
                      periodId: suggestion.period.id,
                      close_previous: true,
                    });
                    toast.success(
                      res.message || `Period ${suggestion.period.name} dibuka`,
                    );
                  } catch (err) {
                    toast.error(
                      err instanceof Error
                        ? err.message
                        : "Gagal membuka period",
                    );
                  }
                }}
                className="h-9 gap-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {openPeriodMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {suggestion.close_previous?.length
                  ? `Tutup sebelumnya & buka ${suggestion.period.name}`
                  : `Buka ${suggestion.period.name}`}
              </Button>
            ) : null}
            <Link
              href={FISCAL_YEAR_ROUTES.edit(suggestion.period.fiscal_year_id)}
              className="text-sm font-medium text-brand-text underline-offset-2 hover:underline"
            >
              Kelola Fiscal Years
            </Link>
          </div>
        </>
      ) : (
        <p>
          Belum ada fiscal period OPEN untuk tanggal{" "}
          <span className="font-medium">{entryDate}</span>.{" "}
          <Link
            href={FISCAL_YEAR_ROUTES.new}
            className="font-medium text-brand-text underline-offset-2 hover:underline"
          >
            Konfigurasi Fiscal Years
          </Link>{" "}
          terlebih dahulu.
        </p>
      )}
    </div>
  );
}

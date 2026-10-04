"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircleIcon } from "@heroicons/react/24/outline";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
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
import { useCloseAccountingPeriod } from "../mutations";
import {
  useAccountingPeriods,
  usePeriodClosePreview,
} from "../queries";
import { PERIOD_ROUTES } from "../routes";

export function PeriodClosingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const periodParam = searchParams.get("period");

  const openPeriodsQuery = useAccountingPeriods({ status: "OPEN" });
  const openPeriods = useMemo(() => openPeriodsQuery.data ?? [], [openPeriodsQuery.data]);

  // Pilihan user > ?period= > period OPEN pertama.
  const [pickedPeriodId, setPeriodId] = useState("");
  const periodId = pickedPeriodId || periodParam || openPeriods[0]?.id || "";
  const [confirmOpen, setConfirmOpen] = useState(false);

  const previewQuery = usePeriodClosePreview(periodId || null);
  const preview = previewQuery.data;
  const closeMutation = useCloseAccountingPeriod();

  const periodOptions = useMemo(
    () =>
      openPeriods.map((p) => ({
        value: p.id,
        label: `${p.fiscal_year_code} — ${p.name} (#${p.period_no})`,
      })),
    [openPeriods]
  );

  async function handleClose() {
    if (!periodId || closeMutation.isPending) return;
    try {
      const res = await closeMutation.mutateAsync(periodId);
      toast.success(res.message || "Period berhasil ditutup");
      setConfirmOpen(false);
      router.push(PERIOD_ROUTES.accountingPeriod);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Gagal menutup period"
      );
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Period Closing</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Soft close: set status CLOSED. Tidak membuat jurnal penutup.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push(PERIOD_ROUTES.accountingPeriod)}
          className="h-10 rounded-lg border-gray-200/80"
        >
          Kembali ke Accounting Period
        </Button>
      </div>

      <PurchasingListSection
        icon={CheckCircleIcon}
        title="Wizard Closing"
        description="Pilih period OPEN, cek draft jurnal, lalu konfirmasi tutup."
      >
        <div className="space-y-6 px-4 py-4">
          <div className="max-w-md space-y-2">
            <Label>Period OPEN</Label>
            {openPeriodsQuery.isLoading ? (
              <div className="flex h-10 items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Memuat...
              </div>
            ) : periodOptions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Tidak ada period OPEN.{" "}
                <button
                  type="button"
                  className="text-brand-text underline-offset-2 hover:underline"
                  onClick={() => router.push(PERIOD_ROUTES.accountingPeriod)}
                >
                  Buka period
                </button>{" "}
                dulu.
              </p>
            ) : (
              <Combobox
                options={periodOptions}
                value={periodId}
                onChange={setPeriodId}
                placeholder="Pilih period"
                searchPlaceholder="Cari period..."
                className="h-10 w-full bg-card"
              />
            )}
          </div>

          {periodId && previewQuery.isLoading ? (
            <div className="py-8 text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand-text" />
            </div>
          ) : null}

          {preview ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-gray-200/70 bg-card p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Ringkasan
                </p>
                <dl className="mt-3 space-y-2 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">FY</dt>
                    <dd className="font-medium">
                      {preview.period.fiscal_year_code}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Period</dt>
                    <dd className="font-medium">{preview.period.name}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Rentang</dt>
                    <dd>
                      {preview.period.start_date} → {preview.period.end_date}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Status</dt>
                    <dd>
                      <Badge
                        variant="outline"
                        className="border-primary/30 text-brand-text"
                      >
                        {preview.period.status}
                      </Badge>
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">JE Posted</dt>
                    <dd className="tabular-nums">{preview.posted_count}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">JE Draft</dt>
                    <dd
                      className={
                        preview.draft_count > 0
                          ? "tabular-nums text-amber-700 dark:text-amber-500"
                          : "tabular-nums"
                      }
                    >
                      {preview.draft_count}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="rounded-lg border border-gray-200/70 bg-card p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Preflight
                </p>
                {preview.can_close ? (
                  <p className="mt-3 text-sm text-foreground">
                    Siap ditutup. Soft close hanya mengubah status period
                    menjadi CLOSED.
                  </p>
                ) : (
                  <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-800 dark:text-amber-400">
                    {preview.blockers.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                )}

                {preview.draft_entries.length > 0 ? (
                  <div className="mt-4">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                      Draft (max 20)
                    </p>
                    <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
                      {preview.draft_entries.map((e) => (
                        <li key={e.id} className="flex justify-between gap-2">
                          <span className="font-medium">{e.entry_no}</span>
                          <span className="truncate text-muted-foreground">
                            {e.entry_date}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-3 h-8 rounded-lg border-gray-200/80"
                      onClick={() =>
                        router.push(PERIOD_ROUTES.journalEntries)
                      }
                    >
                      Buka Journal Entries
                    </Button>
                  </div>
                ) : null}

                <div className="mt-6">
                  <Button
                    type="button"
                    disabled={!preview.can_close || closeMutation.isPending}
                    onClick={() => setConfirmOpen(true)}
                    className="h-10 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    Tutup Period
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </PurchasingListSection>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogPanel size="xs">
          <DialogPanelHeader>
            <DialogPanelTitle>Konfirmasi Closing</DialogPanelTitle>
            <DialogPanelDescription>
              {preview
                ? `Tutup ${preview.period.name}? Setelah CLOSED, jurnal baru di tanggal period ini tidak bisa diposting sampai period dibuka lagi.`
                : ""}
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody>
            <p className="text-sm text-muted-foreground">
              Soft close — tidak ada jurnal penutup otomatis.
            </p>
          </DialogPanelBody>
          <DialogFooter className="gap-3 px-6 py-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={closeMutation.isPending}
            >
              Batal
            </Button>
            <Button
              type="button"
              onClick={handleClose}
              disabled={closeMutation.isPending}
            >
              {closeMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Menutup...
                </>
              ) : (
                "Ya, Tutup"
              )}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>
    </div>
  );
}

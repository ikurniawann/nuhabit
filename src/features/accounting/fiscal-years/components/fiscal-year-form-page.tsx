"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  FormFieldLabel,
  formInputClassName,
} from "@/components/layout/form-field";
import {
  FormPageBody,
  FormPageFooter,
  FormPageHeader,
  FormPageLayout,
  FormPageLoading,
} from "@/components/layout/form-page-layout";
import {
  generateMonthlyPeriods,
  getOpenPeriodBlockReason,
} from "@/lib/accounting/fiscal-periods";
import { useFiscalYear } from "../queries";
import { useCreateFiscalYear, useUpdateFiscalYear } from "../mutations";
import type {
  FiscalPeriodPayload,
  FiscalYearItem,
} from "@/lib/accounting/types";
import { FISCAL_YEAR_ROUTES } from "../routes";
import {
  mergeRegeneratedPeriods,
  planOpenNextPeriod,
  toFormPeriods,
  togglePeriod,
  type FormPeriod,
} from "../period-form";
import { toast } from "sonner";

type FormState = {
  code: string;
  name: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
  periods: FormPeriod[];
};

function defaultYearDates() {
  const y = new Date().getFullYear();
  return {
    start_date: `${y}-01-01`,
    end_date: `${y}-12-31`,
    code: String(y),
    name: `Fiscal Year ${y}`,
  };
}

export function FiscalYearFormPage({
  mode,
  fiscalYearId,
}: {
  mode: "create" | "edit";
  fiscalYearId?: string;
}) {
  const router = useRouter();
  const {
    data: existing,
    isLoading,
    isError,
  } = useFiscalYear(mode === "edit" ? (fiscalYearId ?? null) : null);

  if (mode === "create")
    return <FiscalYearForm mode="create" initial={createFormState()} />;
  if (isLoading) return <FormPageLoading />;
  if (isError || !existing) {
    return (
      <FormPageLayout>
        <FormPageHeader
          title="Fiscal year tidak ditemukan"
          description="Data mungkin sudah dihapus."
          onBack={() => router.push(FISCAL_YEAR_ROUTES.list)}
        />
      </FormPageLayout>
    );
  }
  return (
    <FiscalYearForm
      key={existing.id}
      mode="edit"
      fiscalYearId={existing.id}
      initial={formFromFiscalYear(existing)}
    />
  );
}

function createFormState(): FormState {
  const defaults = defaultYearDates();
  return {
    ...defaults,
    is_active: true,
    periods: toFormPeriods(
      generateMonthlyPeriods(defaults.start_date, defaults.end_date),
    ),
  };
}

function formFromFiscalYear(existing: FiscalYearItem): FormState {
  return {
    code: existing.code,
    name: existing.name,
    start_date: existing.start_date,
    end_date: existing.end_date,
    is_active: existing.is_active,
    periods: existing.periods.map((p) => ({
      key: p.id,
      period_no: p.period_no,
      name: p.name,
      start_date: p.start_date,
      end_date: p.end_date,
      status: p.status,
    })),
  };
}

function FiscalYearForm({
  mode,
  fiscalYearId,
  initial,
}: {
  mode: "create" | "edit";
  fiscalYearId?: string;
  initial: FormState;
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(initial);
  const createMutation = useCreateFiscalYear();
  const updateMutation = useUpdateFiscalYear();
  const isSaving = createMutation.isPending || updateMutation.isPending;

  function regeneratePeriods() {
    try {
      const generated = generateMonthlyPeriods(form.start_date, form.end_date);
      setForm((f) => ({
        ...f,
        periods: mergeRegeneratedPeriods(f.periods, generated),
      }));
      toast.success("12 period bulanan digenerate ulang");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal generate period");
    }
  }

  function updatePeriod(key: string, patch: Partial<FormPeriod>) {
    setForm((f) => ({
      ...f,
      periods: f.periods.map((p) => (p.key === key ? { ...p, ...patch } : p)),
    }));
  }

  function togglePeriodStatus(key: string) {
    const target = form.periods.find((p) => p.key === key);
    if (!target) return;

    // CLOSED → OPEN: wajib period sebelumnya sudah CLOSED
    if (target.status === "CLOSED") {
      const block = getOpenPeriodBlockReason(form.periods, target.period_no);
      if (block) {
        toast.error(block);
        return;
      }
    }

    setForm((f) => ({ ...f, periods: togglePeriod(f.periods, key) }));
  }

  function openNextPeriod() {
    const plan = planOpenNextPeriod(form.periods);
    if (!plan) {
      toast.error("Tidak ada period berikutnya yang bisa dibuka");
      return;
    }
    setForm((f) => ({ ...f, periods: plan.periods }));
    toast.success(
      plan.closedNames
        ? `Menutup ${plan.closedNames} → membuka ${plan.next.name}. Simpan untuk menerapkan.`
        : `Menyarankan buka ${plan.next.name}. Simpan untuk menerapkan.`,
    );
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (isSaving) return;
    if (!form.code.trim() || !form.name.trim()) {
      toast.error("Kode dan nama wajib diisi");
      return;
    }
    if (form.periods.length < 1) {
      toast.error("Generate period terlebih dahulu");
      return;
    }

    const periods: FiscalPeriodPayload[] = form.periods.map((p) => ({
      period_no: p.period_no,
      name: p.name.trim(),
      start_date: p.start_date,
      end_date: p.end_date,
      status: p.status,
    }));

    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      start_date: form.start_date,
      end_date: form.end_date,
      is_active: form.is_active,
      periods,
    };

    try {
      if (mode === "edit" && fiscalYearId) {
        const res = await updateMutation.mutateAsync({
          id: fiscalYearId,
          ...payload,
        });
        toast.success(res.message || "Fiscal year berhasil diperbarui");
        router.push(FISCAL_YEAR_ROUTES.list);
      } else {
        const res = await createMutation.mutateAsync(payload);
        toast.success(res.message || "Fiscal year berhasil ditambahkan");
        // Setelah fiscal dibuat → langsung ke Beginning Balance
        router.push(FISCAL_YEAR_ROUTES.beginningBalance(res.data.id));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan");
    }
  }

  return (
    <FormPageLayout>
      <FormPageHeader
        title={mode === "edit" ? "Edit Fiscal Year" : "Tambah Fiscal Year"}
        description="Tentukan rentang tahun fiskal lalu generate 12 period bulanan. Period berikutnya hanya bisa OPEN setelah period sebelumnya CLOSED. Fiscal year baru juga tidak bisa OPEN jika fiscal sebelumnya masih punya period OPEN."
        onBack={() => router.push(FISCAL_YEAR_ROUTES.list)}
      />

      <form onSubmit={handleSave} className="space-y-6">
        <FormPageBody>
          <section className="rounded-xl border border-gray-200/70 bg-card p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-foreground">
              Informasi fiscal year
            </h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <FormFieldLabel required>Kode</FormFieldLabel>
                <Input
                  value={form.code}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, code: e.target.value }))
                  }
                  className={formInputClassName}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <FormFieldLabel required>Nama</FormFieldLabel>
                <Input
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                  className={formInputClassName}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <FormFieldLabel required>Start date</FormFieldLabel>
                <Input
                  type="date"
                  value={form.start_date}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, start_date: e.target.value }))
                  }
                  className={formInputClassName}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <FormFieldLabel required>End date</FormFieldLabel>
                <Input
                  type="date"
                  value={form.end_date}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, end_date: e.target.value }))
                  }
                  className={formInputClassName}
                  required
                />
              </div>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <Checkbox
                  checked={form.is_active}
                  onCheckedChange={(v) =>
                    setForm((f) => ({ ...f, is_active: Boolean(v) }))
                  }
                />
                Aktif
              </label>
            </div>
          </section>

          <section className="rounded-xl border border-gray-200/70 bg-card p-5 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  Periods
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Toggle OPEN/CLOSED per period. Tidak bisa OPEN jika period
                  sebelumnya belum CLOSED. Generate: period 1 OPEN, sisanya
                  CLOSED.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={openNextPeriod}
                  disabled={form.periods.length === 0}
                  className="h-9 rounded-lg border-primary/20 text-brand-text"
                >
                  Buka period berikutnya
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={regeneratePeriods}
                  className="h-9 rounded-lg border-gray-200/80"
                >
                  Generate 12 period
                </Button>
              </div>
            </div>

            {form.periods.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                Belum ada period. Klik Generate 12 period.
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[700px] text-sm">
                  <thead>
                    <tr className="border-b border-gray-200/70 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      <th className="px-2 py-2">No</th>
                      <th className="px-2 py-2">Nama</th>
                      <th className="px-2 py-2">Start</th>
                      <th className="px-2 py-2">End</th>
                      <th className="px-2 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.periods.map((p) => (
                      <tr
                        key={p.key}
                        className="border-b border-gray-200/70 last:border-0"
                      >
                        <td className="px-2 py-2 text-muted-foreground">
                          {p.period_no}
                        </td>
                        <td className="px-2 py-2">
                          <Input
                            value={p.name}
                            onChange={(e) =>
                              updatePeriod(p.key, { name: e.target.value })
                            }
                            className="h-9 border-gray-200/80"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <Input
                            type="date"
                            value={p.start_date}
                            onChange={(e) =>
                              updatePeriod(p.key, {
                                start_date: e.target.value,
                              })
                            }
                            className="h-9 border-gray-200/80"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <Input
                            type="date"
                            value={p.end_date}
                            onChange={(e) =>
                              updatePeriod(p.key, {
                                end_date: e.target.value,
                              })
                            }
                            className="h-9 border-gray-200/80"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => togglePeriodStatus(p.key)}
                            title={
                              p.status === "CLOSED"
                                ? (getOpenPeriodBlockReason(
                                    form.periods,
                                    p.period_no,
                                  ) ?? "Klik untuk OPEN")
                                : "Klik untuk CLOSED"
                            }
                            className={
                              p.status === "OPEN"
                                ? "h-8 border-primary/20 text-brand-text"
                                : "h-8 border-gray-200/80 text-muted-foreground"
                            }
                          >
                            {p.status}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </FormPageBody>

        <FormPageFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(FISCAL_YEAR_ROUTES.list)}
            disabled={isSaving}
            className="h-10 rounded-lg border-gray-200/80"
          >
            Batal
          </Button>
          <Button
            type="submit"
            disabled={isSaving}
            className="h-10 gap-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Simpan
          </Button>
        </FormPageFooter>
      </form>
    </FormPageLayout>
  );
}

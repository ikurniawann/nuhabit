"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { FormFieldLabel, formInputClassName } from "@/components/layout/form-field";
import {
  FormPageBody,
  FormPageFooter,
  FormPageHeader,
  FormPageLayout,
  FormPageLoading,
} from "@/components/layout/form-page-layout";
import { useCoaList } from "@/features/accounting/chart-of-accounts/queries";
import { useFiscalCoverage } from "@/features/accounting/fiscal-years/queries";
import { useJournalEntry } from "../queries";
import { useCreateJournalEntry, useUpdateJournalEntry } from "../mutations";
import type { JournalEntryItem } from "@/lib/accounting/types";
import {
  createJournalForm,
  journalFormFromEntry,
  journalPayloadLines,
  lineTotals,
  newLine,
  setLineAmount,
  type FormLine,
  type JournalFormState,
} from "../journal-form";
import { FiscalCoverageBanner } from "./fiscal-coverage-banner";
import { JournalLinesTable } from "./journal-lines-table";
import { JOURNAL_ENTRY_ROUTES } from "../routes";
import { toast } from "sonner";
import { formatLedgerAmount } from "@/lib/accounting/format";

export function JournalEntryFormPage({
  mode,
  entryId,
}: {
  mode: "create" | "edit";
  entryId?: string;
}) {
  const router = useRouter();
  const {
    data: existing,
    isLoading,
    isError,
  } = useJournalEntry(mode === "edit" ? (entryId ?? null) : null);

  if (mode === "create")
    return <JournalEntryForm initial={createJournalForm()} />;
  if (isLoading) return <FormPageLoading />;
  if (isError || !existing) {
    return (
      <FormPageLayout>
        <FormPageHeader
          title="Journal entry tidak ditemukan"
          description="Data mungkin sudah dihapus."
          onBack={() => router.push(JOURNAL_ENTRY_ROUTES.list)}
        />
      </FormPageLayout>
    );
  }
  return (
    <JournalEntryForm
      key={existing.id}
      existing={existing}
      initial={journalFormFromEntry(existing)}
    />
  );
}

function JournalEntryForm({
  existing,
  initial,
}: {
  existing?: JournalEntryItem;
  initial: JournalFormState;
}) {
  const router = useRouter();
  const [form, setForm] = useState<JournalFormState>(initial);
  const readOnly = existing ? !existing.can_edit : false;

  const { data: coaData } = useCoaList({
    is_postable: "true",
    is_active: "true",
  });
  const { data: coverage, isLoading: coverageLoading } = useFiscalCoverage(
    form.entry_date,
  );
  const createMutation = useCreateJournalEntry();
  const updateMutation = useUpdateJournalEntry();
  const isSaving = createMutation.isPending || updateMutation.isPending;
  const fiscalReady = coverage?.ready === true;
  const suggestion = coverage?.suggestion ?? null;

  const coaRows = useMemo(() => coaData ?? [], [coaData]);
  const totals = useMemo(() => lineTotals(form.lines), [form.lines]);

  function accountOptionsFor(lineKey: string) {
    const used = new Set(
      form.lines
        .filter((l) => l.key !== lineKey && l.account_id)
        .map((l) => l.account_id),
    );
    return coaRows
      .filter((a) => !used.has(a.id))
      .map((a) => ({
        value: a.id,
        label: `${a.code_display || a.code} — ${a.name}`,
        description: a.is_cash_bank ? "Kas/Bank" : undefined,
      }));
  }

  function updateLine(key: string, patch: Partial<FormLine>) {
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    }));
  }

  function setAmount(key: string, side: "debit" | "credit", value: number) {
    setForm((f) => ({ ...f, lines: setLineAmount(f.lines, key, side, value) }));
  }

  function removeLine(key: string) {
    setForm((f) => ({
      ...f,
      lines: f.lines.filter((l) => l.key !== key),
    }));
  }

  function addLine() {
    setForm((f) => ({
      ...f,
      lines: [...f.lines, newLine({ sort_order: (f.lines.length + 1) * 10 })],
    }));
  }

  async function handleSave(post: boolean) {
    if (isSaving || readOnly) return;
    if (!fiscalReady) {
      toast.error("Fiscal period OPEN belum tersedia untuk tanggal ini");
      return;
    }

    const result = journalPayloadLines(form.lines);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }

    const payload = {
      entry_date: form.entry_date,
      description: form.description.trim() || null,
      lines: result.lines,
      post,
    };

    try {
      const res = existing
        ? await updateMutation.mutateAsync({ id: existing.id, ...payload })
        : await createMutation.mutateAsync(payload);
      toast.success(res.message || "Jurnal berhasil disimpan");
      router.push(JOURNAL_ENTRY_ROUTES.list);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Gagal menyimpan jurnal",
      );
    }
  }

  return (
    <FormPageLayout>
      <FormPageHeader
        title={
          existing
            ? readOnly
              ? `Lihat ${existing.entry_no}`
              : `Edit ${existing.entry_no}`
            : "Tambah Journal Entry"
        }
        description="Jurnal manual: total Debit harus sama dengan Credit. Fiscal period OPEN wajib ada."
        onBack={() => router.push(JOURNAL_ENTRY_ROUTES.list)}
      />

      {!coverageLoading && !fiscalReady ? (
        <FiscalCoverageBanner
          entryDate={form.entry_date}
          suggestion={suggestion}
          readOnly={readOnly}
        />
      ) : null}

      {coverage?.period ? (
        <p className="mb-4 text-xs text-muted-foreground">
          Period: {coverage.period.name} ({coverage.period.fiscal_year_code}) —{" "}
          {coverage.period.status}
        </p>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleSave(false);
        }}
        className="space-y-6"
      >
        <FormPageBody>
          <section className="rounded-xl border border-gray-200/70 bg-card p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-foreground">
              Header jurnal
            </h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <FormFieldLabel>Journal Number</FormFieldLabel>
                <Input
                  value={existing?.entry_no ?? ""}
                  placeholder="Auto-generated by system"
                  className={formInputClassName}
                  disabled
                  readOnly
                />
              </div>
              <div className="space-y-1.5">
                <FormFieldLabel required>Tanggal</FormFieldLabel>
                <Input
                  type="date"
                  value={form.entry_date}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, entry_date: e.target.value }))
                  }
                  className={formInputClassName}
                  required
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <FormFieldLabel>Deskripsi</FormFieldLabel>
                <Input
                  value={form.description}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, description: e.target.value }))
                  }
                  className={formInputClassName}
                  disabled={readOnly}
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-muted-foreground sm:col-span-2">
                <Checkbox checked={form.is_recon} disabled />
                Flag recon (hanya di-set dari rekonsiliasi; entri terkunci)
              </label>
            </div>
          </section>

          <section className="rounded-xl border border-gray-200/70 bg-card p-5 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  Baris jurnal
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Isi Debit atau Credit per baris. Satu akun hanya bisa dipakai
                  sekali. Total Debit harus = Credit.
                </p>
              </div>
              {!readOnly ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={addLine}
                  className="h-9 rounded-lg border-gray-200/80"
                >
                  + Baris
                </Button>
              ) : null}
            </div>

            <JournalLinesTable
              lines={form.lines}
              readOnly={readOnly}
              accountOptionsFor={accountOptionsFor}
              updateLine={updateLine}
              setDebit={(key, v) => setAmount(key, "debit", v)}
              setCredit={(key, v) => setAmount(key, "credit", v)}
              removeLine={removeLine}
            />

            <div className="mt-4 flex flex-wrap gap-4 border-t border-gray-200/70 pt-4 text-sm">
              <div>
                Total Debit:{" "}
                <span className="font-medium tabular-nums">
                  {formatLedgerAmount(totals.debit)}
                </span>
              </div>
              <div>
                Total Credit:{" "}
                <span className="font-medium tabular-nums">
                  {formatLedgerAmount(totals.credit)}
                </span>
              </div>
              <div
                className={
                  totals.diff === 0
                    ? "text-muted-foreground"
                    : "text-destructive"
                }
              >
                Selisih:{" "}
                <span className="font-medium tabular-nums">
                  {formatLedgerAmount(Math.abs(totals.diff))}
                </span>
              </div>
            </div>
          </section>
        </FormPageBody>

        <FormPageFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(JOURNAL_ENTRY_ROUTES.list)}
            disabled={isSaving}
            className="h-10 rounded-lg border-gray-200/80"
          >
            {readOnly ? "Kembali" : "Batal"}
          </Button>
          {!readOnly ? (
            <>
              <Button
                type="submit"
                variant="outline"
                disabled={isSaving || !fiscalReady}
                className="h-10 gap-2 rounded-lg border-gray-200/80"
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Simpan Draft
              </Button>
              <Button
                type="button"
                disabled={isSaving || !fiscalReady}
                onClick={() => void handleSave(true)}
                className="h-10 gap-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Post
              </Button>
            </>
          ) : null}
        </FormPageFooter>
      </form>
    </FormPageLayout>
  );
}

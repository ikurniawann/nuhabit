"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import {
  FormFieldLabel,
  formComboboxClassName,
  formInputClassName,
} from "@/components/layout/form-field";
import {
  FormPageBody,
  FormPageFooter,
  FormPageHeader,
  FormPageLayout,
  FormPageLoading,
} from "@/components/layout/form-page-layout";
import { useCoaList } from "@/features/accounting/chart-of-accounts/queries";
import { JOURNAL_EVENT_CODES, JOURNAL_EVENT_META, JOURNAL_MODULES, type JournalEventCode, type JournalModule } from "@/lib/accounting/journal-mapping-types";
import { useJournalMapping, useJournalMappingList } from "../queries";
import { useCreateJournalMapping, useUpdateJournalMapping } from "../mutations";
import {
  createMappingForm,
  mappingFormFromItem,
  mappingPayload,
  newMappingLine,
  type MappingFormLine,
  type MappingFormState,
} from "../mapping-form";
import { MappingLinesSection } from "./mapping-lines-section";
import { JOURNAL_MAPPING_ROUTES } from "../routes";
import { toast } from "sonner";

export function JournalMappingFormPage({
  mode,
  mappingId,
}: {
  mode: "create" | "edit";
  mappingId?: string;
}) {
  const router = useRouter();
  const {
    data: existing,
    isLoading,
    isError,
  } = useJournalMapping(mode === "edit" ? (mappingId ?? null) : null);

  if (mode === "create")
    return <JournalMappingForm initial={createMappingForm()} />;
  if (isLoading) return <FormPageLoading />;
  if (isError || !existing) {
    return (
      <FormPageLayout>
        <FormPageHeader
          title="Mapping tidak ditemukan"
          description="Data mungkin sudah dihapus."
          onBack={() => router.push(JOURNAL_MAPPING_ROUTES.list)}
        />
      </FormPageLayout>
    );
  }
  return (
    <JournalMappingForm
      key={existing.id}
      mappingId={existing.id}
      initial={mappingFormFromItem(existing)}
    />
  );
}

function JournalMappingForm({
  mappingId,
  initial,
}: {
  mappingId?: string;
  initial: MappingFormState;
}) {
  const router = useRouter();
  const mode = mappingId ? "edit" : "create";
  const [form, setForm] = useState<MappingFormState>(initial);

  const { data: listData } = useJournalMappingList();
  const { data: coaData } = useCoaList({ is_postable: "true" });
  const createMutation = useCreateJournalMapping();
  const updateMutation = useUpdateJournalMapping();

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const coaRows = useMemo(() => coaData ?? [], [coaData]);
  const listRows = useMemo(() => listData ?? [], [listData]);

  const moduleOptions = useMemo(
    () => JOURNAL_MODULES.map((m) => ({ value: m, label: m })),
    [],
  );

  const eventOptions = useMemo(() => {
    const used = new Set(
      listRows
        .filter((r) => (mode === "edit" ? r.id !== mappingId : true))
        .map((r) => r.event_code),
    );
    return JOURNAL_EVENT_CODES.filter((code) => !used.has(code)).map(
      (code) => ({
        value: code,
        label: code,
        description: JOURNAL_EVENT_META[code].name,
      }),
    );
  }, [listRows, mode, mappingId]);

  function applyEvent(code: string) {
    const meta = JOURNAL_EVENT_META[code as JournalEventCode];
    setForm((f) => ({
      ...f,
      event_code: code,
      name: meta?.name || f.name || code,
      description: meta?.description || f.description,
      module: meta?.module || f.module || "",
    }));
  }

  function updateLine(key: string, patch: Partial<MappingFormLine>) {
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    }));
  }

  function removeLine(key: string) {
    setForm((f) => ({
      ...f,
      lines: f.lines.filter((l) => l.key !== key),
    }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (isSaving) return;
    const result = mappingPayload(form);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    const payload = result.payload;

    try {
      if (mappingId) {
        const res = await updateMutation.mutateAsync({
          id: mappingId,
          ...payload,
        });
        toast.success(res.message || "Mapping berhasil diperbarui");
      } else {
        const res = await createMutation.mutateAsync(payload);
        toast.success(res.message || "Mapping berhasil ditambahkan");
      }
      router.push(JOURNAL_MAPPING_ROUTES.list);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Gagal menyimpan mapping",
      );
    }
  }

  return (
    <FormPageLayout>
      <FormPageHeader
        title={
          mode === "edit" ? "Edit Journal Mapping" : "Tambah Journal Mapping"
        }
        description="Template jurnal otomatis: saat event terjadi, sistem nanti membuat jurnal mengikuti baris Debit/Credit dan akun COA di bawah."
        onBack={() => router.push(JOURNAL_MAPPING_ROUTES.list)}
      />

      <form onSubmit={handleSave} className="space-y-6">
        <FormPageBody>
          <section className="rounded-xl border border-gray-200/70 bg-card p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-foreground">
              Informasi event
            </h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <FormFieldLabel required>Event</FormFieldLabel>
                <Combobox
                  options={
                    mode === "edit" && form.event_code
                      ? [
                          {
                            value: form.event_code,
                            label: form.event_code,
                            description:
                              JOURNAL_EVENT_META[
                                form.event_code as JournalEventCode
                              ]?.name,
                          },
                          ...eventOptions,
                        ]
                      : eventOptions
                  }
                  value={form.event_code}
                  onChange={applyEvent}
                  placeholder="Pilih event bisnis"
                  searchPlaceholder="Cari event..."
                  disabled={mode === "edit"}
                  className={formComboboxClassName}
                />
                <p className="text-xs text-muted-foreground">
                  Kode kejadian bisnis (POS sale, GRN, pembayaran vendor, dll.).
                </p>
              </div>
              <div className="space-y-1.5">
                <FormFieldLabel required>Module</FormFieldLabel>
                <Combobox
                  options={moduleOptions}
                  value={form.module}
                  onChange={(value) =>
                    setForm((f) => ({
                      ...f,
                      module: value as JournalModule | "",
                    }))
                  }
                  placeholder="Pilih module"
                  className={formComboboxClassName}
                />
                <p className="text-xs text-muted-foreground">
                  Modul sumber transaksi: POS atau Purchasing.
                </p>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
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
              <div className="space-y-1.5 sm:col-span-2">
                <FormFieldLabel>Deskripsi</FormFieldLabel>
                <Input
                  value={form.description}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, description: e.target.value }))
                  }
                  className={formInputClassName}
                />
              </div>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <Checkbox
                  checked={form.is_active}
                  onCheckedChange={(v) =>
                    setForm((f) => ({ ...f, is_active: Boolean(v) }))
                  }
                />
                Aktif (dipakai saat posting)
              </label>
            </div>
          </section>

          <MappingLinesSection
            lines={form.lines}
            coaRows={coaRows}
            onAdd={() =>
              setForm((f) => ({
                ...f,
                lines: [
                  ...f.lines,
                  newMappingLine({ sort_order: (f.lines.length + 1) * 10 }),
                ],
              }))
            }
            onUpdate={updateLine}
            onRemove={removeLine}
          />
        </FormPageBody>

        <FormPageFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(JOURNAL_MAPPING_ROUTES.list)}
            disabled={isSaving}
            className="h-10 rounded-lg border-gray-200/80"
          >
            Batal
          </Button>
          <Button
            type="submit"
            disabled={isSaving}
            className="h-10 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Menyimpan...
              </>
            ) : (
              "Simpan"
            )}
          </Button>
        </FormPageFooter>
      </form>
    </FormPageLayout>
  );
}

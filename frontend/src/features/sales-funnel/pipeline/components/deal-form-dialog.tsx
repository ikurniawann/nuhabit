"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLeads } from "../../leads/queries";
import { ORG_TYPE_LABELS, type SalesLead } from "../../leads/types";
import { useCreateDeal, usePipelines, useUpdateDeal } from "../queries";
import { CustomFieldsSection } from "@/features/crm/custom-fields";
import {
  EMPTY_DEAL_FORM,
  EVENT_TYPE_LABELS,
  type DealFilters,
  type DealFormValues,
  type SalesDeal,
} from "../types";

interface DealFormDialogProps {
  /** EPIC-050 Fase 3: pipeline aktif di kanban → default deal baru */
  defaultPipelineId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = mode tambah; terisi = mode edit */
  deal: SalesDeal | null;
  /** Prefill lead saat konversi dari halaman Leads */
  initialLead?: SalesLead | null;
  /** Filter kanban aktif — untuk optimistic cache useUpdateDeal */
  filters?: DealFilters;
  /** Mode edit: tampilkan tombol hapus (konfirmasi di pemanggil) */
  onDelete?: () => void;
}

const NO_FILTER = { status: "", org_type: "", source: "", page: 1 };

function dealToForm(deal: SalesDeal): DealFormValues {
  return {
    lead_id: deal.lead_id,
    title: deal.title,
    event_type: deal.event_type,
    event_date: deal.event_date?.slice(0, 10) ?? "",
    is_event_date_fixed: deal.is_event_date_fixed,
    pax_estimate: deal.pax_estimate?.toString() ?? "",
    value_estimate: deal.value_estimate ?? "",
    pipeline_id: deal.pipeline_id ?? "",
    custom: deal.custom ?? {},
  };
}

export function DealFormDialog({ open, onOpenChange, ...formProps }: DealFormDialogProps) {
  const { deal, initialLead, defaultPipelineId } = formProps;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DealFormBody
          key={deal?.id ?? `new:${initialLead?.id ?? ""}:${defaultPipelineId ?? ""}`}
          {...formProps}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function initialForm(deal: SalesDeal | null, initialLead: SalesLead | null, defaultPipelineId?: string): DealFormValues {
  if (deal) return dealToForm(deal);
  return {
    ...EMPTY_DEAL_FORM,
    pipeline_id: defaultPipelineId ?? "",
    lead_id: initialLead?.id ?? "",
    title: initialLead ? `Acara ${initialLead.org_name}` : "",
  };
}

/** Isi form; di-mount ulang per deal/lead (key) sehingga state awal dari props. */
function DealFormBody({
  deal,
  initialLead = null,
  filters = { q: "", event_type: "" },
  onDelete,
  defaultPipelineId,
  onClose,
}: Omit<DealFormDialogProps, "open" | "onOpenChange"> & { onClose: () => void }) {
  const [form, setForm] = useState<DealFormValues>(() => initialForm(deal, initialLead, defaultPipelineId));
  const [leadSearch, setLeadSearch] = useState("");
  const [leadQuery, setLeadQuery] = useState("");
  const isEdit = deal !== null;

  // Debounce pencarian lead — pola sama dengan leads-page (300ms)
  useEffect(() => {
    const timeout = window.setTimeout(() => setLeadQuery(leadSearch.trim()), 300);
    return () => window.clearTimeout(timeout);
  }, [leadSearch]);

  // Picker lead hanya untuk mode tambah tanpa prefill
  const needsLeadPicker = !isEdit && !initialLead;
  const leadsQuery = useLeads({ q: needsLeadPicker ? leadQuery : "", ...NO_FILTER });
  const leadOptions = useMemo(
    () =>
      (leadsQuery.data?.data ?? []).filter(
        (lead) => lead.status !== "tidak-cocok"
      ),
    [leadsQuery.data]
  );

  const createMutation = useCreateDeal(onClose);
  const updateMutation = useUpdateDeal(filters, onClose);
  const pipelinesQuery = usePipelines();
  const pipelines = pipelinesQuery.data ?? [];
  const isPending = createMutation.isPending || updateMutation.isPending;

  const set = <K extends keyof DealFormValues>(key: K, value: DealFormValues[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const canSubmit = form.title.trim() !== "" && (isEdit || form.lead_id !== "");

  const handleSubmit = () => {
    if (!canSubmit || isPending) return;
    if (deal) {
      updateMutation.mutate({
        id: deal.id,
        values: {
          title: form.title,
          event_type: form.event_type,
          event_date: form.event_date || null,
          is_event_date_fixed: form.is_event_date_fixed,
          pax_estimate: form.pax_estimate ? Number(form.pax_estimate) : null,
          value_estimate: form.value_estimate ? Number(form.value_estimate) : null,
          custom: form.custom ?? {},
        },
      });
    } else {
      createMutation.mutate(form);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {isEdit
            ? "Edit Deal"
            : initialLead
              ? `Konversi Lead: ${initialLead.org_name}`
              : "Tambah Deal"}
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-4">
        {needsLeadPicker ? (
          <div className="space-y-1.5">
            <Label>Lead / Instansi *</Label>
            <Input
              value={leadSearch}
              onChange={(e) => setLeadSearch(e.target.value)}
              placeholder="Cari instansi atau PIC..."
              className="mb-1.5"
            />
            <Select
              value={form.lead_id}
              onValueChange={(v) => {
                set("lead_id", v);
                const lead = leadOptions.find((l) => l.id === v);
                if (lead && !form.title.trim()) {
                  set("title", `Acara ${lead.org_name}`);
                }
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pilih lead..." />
              </SelectTrigger>
              <SelectContent>
                {leadOptions.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-gray-500">
                    {leadsQuery.isLoading ? "Memuat..." : "Tidak ada lead"}
                  </div>
                ) : (
                  leadOptions.map((lead) => (
                    <SelectItem key={lead.id} value={lead.id}>
                      {lead.org_name} — {ORG_TYPE_LABELS[lead.org_type]} ({lead.pic_name})
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {!isEdit && pipelines.length > 1 ? (
          <div className="space-y-1.5">
            <Label>Pipeline</Label>
            <Select
              value={form.pipeline_id || pipelines.find((p) => p.is_default)?.id || pipelines[0]?.id || ""}
              onValueChange={(v) => set("pipeline_id", v)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {pipelines.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="deal_title">Judul Deal *</Label>
          <Input
            id="deal_title"
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="Gathering akhir tahun PT Maju"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Jenis Acara</Label>
            <Select
              value={form.event_type}
              onValueChange={(v) => set("event_type", v as DealFormValues["event_type"])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pax_estimate">Estimasi Pax</Label>
            <Input
              id="pax_estimate"
              type="number"
              min={1}
              value={form.pax_estimate}
              onChange={(e) => set("pax_estimate", e.target.value)}
              placeholder="50"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="event_date">Tanggal Acara</Label>
            <Input
              id="event_date"
              type="date"
              value={form.event_date}
              onChange={(e) => set("event_date", e.target.value)}
            />
            <label className="flex items-center gap-2 pt-1 text-xs text-gray-600">
              <Checkbox
                checked={form.is_event_date_fixed}
                onCheckedChange={(checked) =>
                  set("is_event_date_fixed", checked === true)
                }
              />
              Tanggal sudah fix (bukan tentatif)
            </label>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="value_estimate">Nilai Estimasi (Rp)</Label>
            <Input
              id="value_estimate"
              type="number"
              min={0}
              value={form.value_estimate}
              onChange={(e) => set("value_estimate", e.target.value)}
              placeholder="15000000"
            />
          </div>
          <CustomFieldsSection object="deal" values={form.custom ?? {}} onChange={(next) => set("custom", next)} columns={1} />
        </div>
      </div>

      <DialogFooter>
        {isEdit && onDelete ? (
          <Button
            variant="ghost"
            onClick={onDelete}
            disabled={isPending}
            className="mr-auto text-red-600 hover:bg-red-50 hover:text-red-700"
          >
            Hapus
          </Button>
        ) : null}
        <Button variant="outline" onClick={onClose} disabled={isPending}>
          Batal
        </Button>
        <Button onClick={handleSubmit} disabled={!canSubmit || isPending}>
          {isPending ? "Menyimpan…" : isEdit ? "Simpan Perubahan" : "Buat Deal"}
        </Button>
      </DialogFooter>
    </>
  );
}

"use client";

import { useMemo, useState } from "react";
import { ChartBarIcon } from "@heroicons/react/24/outline";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { DATE_PRESETS, DATE_PRESET_LABELS, reportDefinitionSchema, type DatePreset } from "@/lib/crm/report-builder";
import { useRunDefinition } from "@/features/crm/report-builder/queries";
import { ReportResultView } from "@/features/crm/report-builder";
import type { ReportResult } from "@/features/crm/report-builder/types";

/** Dimensi atribusi: sumber lead apa adanya, atau parameter UTM dari iklan. */
const DIMENSIONS = [
  { key: "lead_source", leadKey: "source", label: "Sumber Lead" },
  { key: "utm_source", leadKey: "utm_source", label: "UTM Source" },
  { key: "utm_medium", leadKey: "utm_medium", label: "UTM Medium" },
  { key: "utm_campaign", leadKey: "utm_campaign", label: "UTM Campaign" },
] as const;

type DimensionKey = (typeof DIMENSIONS)[number]["key"];

/** EPIC-050 T-5.2 — laporan sumber → deal → pendapatan. */
export function AttributionPage() {
  const [dimension, setDimension] = useState<DimensionKey>("lead_source");
  const [preset, setPreset] = useState<DatePreset>("this_year");
  const [leads, setLeads] = useState<ReportResult | null>(null);
  const [deals, setDeals] = useState<ReportResult | null>(null);
  const leadsRun = useRunDefinition();
  const dealsRun = useRunDefinition();

  const dim = useMemo(() => DIMENSIONS.find((d) => d.key === dimension) ?? DIMENSIONS[0], [dimension]);

  const run = (d: DimensionKey = dimension, p: DatePreset = preset) => {
    const meta = DIMENSIONS.find((x) => x.key === d) ?? DIMENSIONS[0];
    leadsRun.mutate(
      reportDefinitionSchema.parse({
        dataset: "lead", date_preset: p, group_by: [meta.leadKey],
        aggregates: [{ fn: "count" }, { fn: "avg", field: "score" }],
        chart_type: "column", sort_dir: "desc",
      }),
      { onSuccess: setLeads }
    );
    dealsRun.mutate(
      reportDefinitionSchema.parse({
        dataset: "deal", date_preset: p, group_by: [meta.key],
        aggregates: [{ fn: "count" }, { fn: "sum", field: "value" }, { fn: "sum", field: "weighted_value" }],
        chart_type: "column", sort_dir: "desc",
      }),
      { onSuccess: setDeals }
    );
  };

  const pending = leadsRun.isPending || dealsRun.isPending;

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Atribusi Sumber</h1>
          <p className="mt-1 text-sm text-gray-500">
            Dari mana lead datang dan berapa nilainya setelah jadi deal. Parameter UTM terisi otomatis dari tautan iklan ke form publik.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={dimension} onValueChange={(v) => { setDimension(v as DimensionKey); run(v as DimensionKey); }}>
            <SelectTrigger className="h-10 w-44 bg-white"><SelectValue /></SelectTrigger>
            <SelectContent>{DIMENSIONS.map((d) => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={preset} onValueChange={(v) => { setPreset(v as DatePreset); run(dimension, v as DatePreset); }}>
            <SelectTrigger className="h-10 w-40 bg-white"><SelectValue /></SelectTrigger>
            <SelectContent>{DATE_PRESETS.filter((p) => p !== "custom").map((p) => <SelectItem key={p} value={p}>{DATE_PRESET_LABELS[p]}</SelectItem>)}</SelectContent>
          </Select>
          <Button type="button" className="h-10 bg-pink-600 text-white hover:bg-pink-700" onClick={() => run()} disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Muat"}
          </Button>
        </div>
      </div>

      <PurchasingListSection icon={ChartBarIcon} title={`Lead per ${dim.label}`} description="Jumlah lead masuk dan rata-rata skornya.">
        {leadsRun.isPending && !leads ? (
          <div className="py-14 text-center"><Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" /></div>
        ) : leads ? (
          <div className="px-4 py-4"><ReportResultView result={leads} chartType="column" height={300} /></div>
        ) : (
          <p className="py-14 text-center text-sm text-gray-500">Tekan Muat untuk melihat data.</p>
        )}
      </PurchasingListSection>

      <PurchasingListSection icon={ChartBarIcon} title={`Deal & Pendapatan per ${dim.label}`} description="Nilai deal yang berasal dari tiap sumber, beserta pipeline tertimbang.">
        {dealsRun.isPending && !deals ? (
          <div className="py-14 text-center"><Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" /></div>
        ) : deals ? (
          <>
            <div className="px-4 py-4"><ReportResultView result={deals} chartType="column" height={300} /></div>
            <ReportResultView result={deals} chartType="table" />
          </>
        ) : (
          <p className="py-14 text-center text-sm text-gray-500">Tekan Muat untuk melihat data.</p>
        )}
      </PurchasingListSection>
    </div>
  );
}

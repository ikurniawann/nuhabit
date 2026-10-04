"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChartBarIcon, TableCellsIcon } from "@heroicons/react/24/outline";
import { Download, Loader2, Play, Plus, Save, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { reportDefinitionSchema, type ReportDefinition } from "@/lib/crm/report-builder";
import { downloadReportXlsx } from "../api";
import {
  useCreateReport, useDeleteReport, useReportRegistry, useRunDefinition, useSavedReport, useSavedReports, useUpdateReport,
} from "../queries";
import type { DatasetMeta, ReportDataset, ReportResult, SavedReport } from "../types";
import { ReportResultView } from "./report-result-view";

const emptyDefinition = (dataset: ReportDataset = "deal"): ReportDefinition => reportDefinitionSchema.parse({ dataset });

/** EPIC-050 T-4.1 — Report Builder: dataset → kolom → filter → group → chart. */
export function ReportBuilderPage() {
  const searchParams = useSearchParams();
  const requestedId = searchParams.get("report");
  const registryQuery = useReportRegistry();
  const reportsQuery = useSavedReports();
  const [selectedId, setSelectedId] = useState<string | null>(requestedId);
  const [newKey, setNewKey] = useState(0);
  const savedQuery = useSavedReport(selectedId);
  const deleteMutation = useDeleteReport();
  const [deleting, setDeleting] = useState<SavedReport | null>(null);

  const registry = registryQuery.data;
  const reports = reportsQuery.data ?? [];
  const loadingSaved = Boolean(selectedId) && savedQuery.isLoading;

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Report Builder</h1>
          <p className="mt-1 text-sm text-gray-500">
            Rakit laporan sendiri: pilih data, saring, kelompokkan, lalu tampilkan sebagai tabel atau grafik. Bisa disimpan, dipasang di dashboard, dan dikirim terjadwal.
          </p>
        </div>
        <Button
          type="button"
          className="h-10 gap-2 rounded-lg bg-pink-600 text-white hover:bg-pink-700"
          onClick={() => { setSelectedId(null); setNewKey((k) => k + 1); }}
        >
          <Plus className="h-4 w-4" /> Report Baru
        </Button>
      </div>

      {reports.length > 0 ? (
        <PurchasingListSection icon={TableCellsIcon} title="Report Tersimpan" description="Klik untuk membuka di builder.">
          <ul className="divide-y divide-gray-200/60">
            {reports.map((r) => (
              <li key={r.id} className={`flex flex-wrap items-center gap-3 px-5 py-3 text-sm ${selectedId === r.id ? "bg-pink-50/60" : ""}`}>
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSelectedId(r.id)}>
                  <p className="font-medium text-gray-900">{r.name}</p>
                  <p className="text-xs text-gray-500">
                    {registry?.datasets.find((d) => d.key === r.dataset)?.label ?? r.dataset}
                    {r.description ? ` · ${r.description}` : ""}
                    {r.creator_name ? ` · oleh ${r.creator_name}` : ""}
                  </p>
                </button>
                {Number(r.active_schedules ?? 0) > 0 ? (
                  <Badge className="border-0 bg-amber-100 font-normal text-amber-700">{r.active_schedules} jadwal</Badge>
                ) : null}
                {!r.is_shared ? <Badge className="border-0 bg-gray-100 font-normal text-gray-600">privat</Badge> : null}
                <button type="button" className="text-xs text-gray-500 hover:text-pink-700" onClick={() => downloadReportXlsx(r.id, `${r.name}.xlsx`).catch(() => undefined)}>
                  Ekspor
                </button>
                <button type="button" className="text-xs text-gray-400 hover:text-red-600" onClick={() => setDeleting(r)}>Hapus</button>
              </li>
            ))}
          </ul>
        </PurchasingListSection>
      ) : null}

      {registryQuery.isLoading || loadingSaved ? (
        <div className="py-20 text-center"><Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" /></div>
      ) : !registry ? (
        <p className="py-20 text-center text-sm text-gray-500">Gagal memuat daftar dataset.</p>
      ) : (
        <BuilderBody
          key={selectedId ?? `new-${newKey}`}
          registry={registry.datasets}
          registryMeta={registry}
          saved={selectedId ? savedQuery.data?.report ?? null : null}
          initialResult={selectedId ? savedQuery.data?.result ?? null : null}
          onSaved={(id) => setSelectedId(id)}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Hapus report?"
        description={`"${deleting?.name ?? ""}" dihapus dari daftar. Widget dashboard dan jadwal yang memakainya ikut terhapus.`}
        confirmLabel="Hapus"
        variant="danger"
        onConfirm={() => {
          if (deleting) {
            deleteMutation.mutate(deleting.id);
            if (selectedId === deleting.id) setSelectedId(null);
          }
          setDeleting(null);
        }}
      />
    </div>
  );
}

interface BuilderBodyProps {
  registry: DatasetMeta[];
  registryMeta: NonNullable<ReturnType<typeof useReportRegistry>["data"]>;
  saved: SavedReport | null;
  initialResult: ReportResult | null;
  onSaved: (id: string) => void;
}

function BuilderBody({ registry, registryMeta, saved, initialResult, onSaved }: BuilderBodyProps) {
  const [def, setDef] = useState<ReportDefinition>(saved?.definition ?? emptyDefinition());
  const [result, setResult] = useState<ReportResult | null>(initialResult);
  const [saveOpen, setSaveOpen] = useState(false);
  const runMutation = useRunDefinition();
  const createMutation = useCreateReport();
  const updateMutation = useUpdateReport();

  const ds = useMemo(() => registry.find((d) => d.key === def.dataset) ?? registry[0], [registry, def.dataset]);
  const fields = useMemo(() => ds?.fields ?? [], [ds]);
  const fieldByKey = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields]);

  const run = (d: ReportDefinition = def) => {
    runMutation.mutate(d, { onSuccess: (r) => setResult(r) });
  };

  // Jalankan otomatis sekali saat builder dibuka tanpa hasil bawaan.
  const autoRan = useRef(false);
  useEffect(() => {
    if (autoRan.current || initialResult) return;
    autoRan.current = true;
    run(def);
    // sengaja hanya sekali saat mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patch = (p: Partial<ReportDefinition>) => setDef((prev) => ({ ...prev, ...p }));

  const changeDataset = (dataset: ReportDataset) => {
    // Field antar dataset tidak kompatibel — mulai dari definisi bersih.
    const fresh = emptyDefinition(dataset);
    setDef(fresh);
    setResult(null);
    run(fresh);
  };

  const aggregatable = fields.filter((f) => f.aggregatable);
  const canChart = def.group_by.length > 0;

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[24rem_1fr]">
      <div className="space-y-4">
        <PurchasingListSection icon={ChartBarIcon} title="Susun Report" description="Perubahan diterapkan saat menekan Jalankan.">
          <div className="space-y-4 px-5 py-4">
            <div className="space-y-1.5">
              <Label>Data</Label>
              <Select value={def.dataset} onValueChange={(v) => changeDataset(v as ReportDataset)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{registry.map((d) => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>Tanggal acuan</Label>
                <Select value={def.date_field ?? ds?.date_field ?? ""} onValueChange={(v) => patch({ date_field: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {fields.filter((f) => f.type === "date" || f.type === "datetime").map((f) => (
                      <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Periode</Label>
                <Select value={def.date_preset} onValueChange={(v) => patch({ date_preset: v as ReportDefinition["date_preset"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{registryMeta.date_presets.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            {def.date_preset === "custom" ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5"><Label>Dari</Label><Input type="date" value={def.date_from ?? ""} onChange={(e) => patch({ date_from: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Sampai</Label><Input type="date" value={def.date_to ?? ""} onChange={(e) => patch({ date_to: e.target.value })} /></div>
              </div>
            ) : null}

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <Label>Filter</Label>
                <Button type="button" size="sm" variant="outline" className="h-7 text-xs"
                  onClick={() => patch({ filters: [...def.filters, { field: fields[0]?.key ?? "", op: "eq", value: "" }] })}>
                  + filter
                </Button>
              </div>
              <div className="space-y-2">
                {def.filters.length === 0 ? <p className="text-xs text-gray-500">Tanpa filter — semua baris pada periode di atas.</p> : null}
                {def.filters.map((f, i) => {
                  const meta = fieldByKey.get(f.field);
                  const needsValue = f.op !== "is_empty" && f.op !== "not_empty";
                  return (
                    <div key={i} className="space-y-1.5 rounded-lg border border-gray-200/70 bg-gray-50/50 p-2">
                      <div className="flex gap-1.5">
                        <Select value={f.field} onValueChange={(v) => patch({ filters: def.filters.map((x, j) => (j === i ? { ...x, field: v } : x)) })}>
                          <SelectTrigger className="h-8 flex-1 bg-white text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>{fields.map((x) => <SelectItem key={x.key} value={x.key}>{x.label}</SelectItem>)}</SelectContent>
                        </Select>
                        <button type="button" className="px-1 text-gray-400 hover:text-red-600" onClick={() => patch({ filters: def.filters.filter((_, j) => j !== i) })}>
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="flex gap-1.5">
                        <Select value={f.op} onValueChange={(v) => patch({ filters: def.filters.map((x, j) => (j === i ? { ...x, op: v as typeof x.op } : x)) })}>
                          <SelectTrigger className="h-8 w-32 bg-white text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>{registryMeta.filter_ops.map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}</SelectContent>
                        </Select>
                        {needsValue ? (
                          meta?.options?.length ? (
                            <Select value={String(f.value ?? "")} onValueChange={(v) => patch({ filters: def.filters.map((x, j) => (j === i ? { ...x, value: v } : x)) })}>
                              <SelectTrigger className="h-8 flex-1 bg-white text-xs"><SelectValue placeholder="pilih" /></SelectTrigger>
                              <SelectContent>{meta.options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                            </Select>
                          ) : (
                            <Input
                              className="h-8 flex-1 bg-white text-xs"
                              type={meta?.type === "number" || meta?.type === "currency" ? "number" : meta?.type === "date" ? "date" : "text"}
                              value={String(f.value ?? "")}
                              onChange={(e) => patch({ filters: def.filters.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })}
                              placeholder="nilai"
                            />
                          )
                        ) : null}
                        {f.op === "between" ? (
                          <Input className="h-8 w-24 bg-white text-xs" type="number" value={String(f.value2 ?? "")}
                            onChange={(e) => patch({ filters: def.filters.map((x, j) => (j === i ? { ...x, value2: e.target.value } : x)) })} placeholder="s/d" />
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Kelompokkan (group by)</Label>
              <Select
                value={def.group_by[0] ?? "none"}
                onValueChange={(v) => patch({ group_by: v === "none" ? [] : [v], chart_type: v === "none" ? "table" : def.chart_type === "table" ? "column" : def.chart_type })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Tanpa pengelompokan (tabel rinci)</SelectItem>
                  {fields.map((f) => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {def.group_by.length > 0 && fieldByKey.get(def.group_by[0])?.type?.includes("date") ? (
                <Select value={def.date_bucket} onValueChange={(v) => patch({ date_bucket: v as ReportDefinition["date_bucket"] })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>{registryMeta.date_buckets.map((b) => <SelectItem key={b.key} value={b.key}>{b.label}</SelectItem>)}</SelectContent>
                </Select>
              ) : null}
            </div>

            {def.group_by.length > 0 ? (
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <Label>Hitung</Label>
                  <Button type="button" size="sm" variant="outline" className="h-7 text-xs"
                    onClick={() => patch({ aggregates: [...def.aggregates, { fn: "sum", field: aggregatable[0]?.key ?? null }] })}>
                    + hitungan
                  </Button>
                </div>
                <div className="space-y-1.5">
                  {def.aggregates.length === 0 ? <p className="text-xs text-gray-500">Default: jumlah baris.</p> : null}
                  {def.aggregates.map((a, i) => (
                    <div key={i} className="flex gap-1.5">
                      <Select value={a.fn} onValueChange={(v) => patch({ aggregates: def.aggregates.map((x, j) => (j === i ? { ...x, fn: v as typeof x.fn } : x)) })}>
                        <SelectTrigger className="h-8 w-32 bg-white text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>{registryMeta.aggregations.map((x) => <SelectItem key={x.key} value={x.key}>{x.label}</SelectItem>)}</SelectContent>
                      </Select>
                      {a.fn !== "count" ? (
                        <Select value={a.field ?? ""} onValueChange={(v) => patch({ aggregates: def.aggregates.map((x, j) => (j === i ? { ...x, field: v } : x)) })}>
                          <SelectTrigger className="h-8 flex-1 bg-white text-xs"><SelectValue placeholder="field" /></SelectTrigger>
                          <SelectContent>
                            {(a.fn === "count_distinct" ? fields : aggregatable).map((f) => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : <div className="flex-1" />}
                      <button type="button" className="px-1 text-gray-400 hover:text-red-600" onClick={() => patch({ aggregates: def.aggregates.filter((_, j) => j !== i) })}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>Kolom</Label>
                <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-gray-200/70 p-2">
                  {fields.map((f) => {
                    const active = def.columns.length > 0 ? def.columns.includes(f.key) : ds.default_columns.includes(f.key);
                    return (
                      <label key={f.key} className="flex cursor-pointer items-center gap-2 text-xs text-gray-700">
                        <input
                          type="checkbox"
                          className="rounded border-gray-300 text-pink-600"
                          checked={active}
                          onChange={(e) => {
                            const base = def.columns.length > 0 ? def.columns : [...ds.default_columns];
                            patch({ columns: e.target.checked ? [...base, f.key] : base.filter((k) => k !== f.key) });
                          }}
                        />
                        {f.label}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>Tampilan</Label>
                <Select value={def.chart_type} onValueChange={(v) => patch({ chart_type: v as ReportDefinition["chart_type"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {/* Grafik butuh kolom agregasi, jadi hanya muncul saat ada group by. */}
                    {registryMeta.chart_types
                      .filter((c) => c.key === "table" || canChart)
                      .map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Batas baris</Label>
                <Input type="number" min={1} max={5000} value={def.limit} onChange={(e) => patch({ limit: Math.min(5000, Math.max(1, Number(e.target.value) || 1)) })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>Urut</Label>
                <Select value={def.sort_dir} onValueChange={(v) => patch({ sort_dir: v as "asc" | "desc" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="desc">Terbesar / terbaru dulu</SelectItem>
                    <SelectItem value="asc">Terkecil / terlama dulu</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Button type="button" className="w-full gap-2 bg-pink-600 text-white hover:bg-pink-700" onClick={() => run()} disabled={runMutation.isPending}>
              {runMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Jalankan
            </Button>
          </div>
        </PurchasingListSection>
      </div>

      <div className="space-y-4">
        <PurchasingListSection
          icon={ChartBarIcon}
          title={saved?.name ?? "Pratinjau"}
          description={result ? `${result.row_count} baris${result.truncated ? ` (dipotong pada batas ${def.limit})` : ""}` : "Tekan Jalankan untuk melihat hasil."}
          toolbar={
            <div className="flex flex-wrap gap-2">
              {saved ? (
                <Button type="button" size="sm" variant="outline" className="h-9 gap-1" onClick={() => downloadReportXlsx(saved.id, `${saved.name}.xlsx`).catch(() => undefined)}>
                  <Download className="h-4 w-4" /> XLSX
                </Button>
              ) : null}
              {saved ? (
                <Button type="button" size="sm" variant="outline" className="h-9 gap-1" disabled={updateMutation.isPending}
                  onClick={() => updateMutation.mutate({ id: saved.id, values: { definition: def } })}>
                  <Save className="h-4 w-4" /> Simpan perubahan
                </Button>
              ) : null}
              <Button type="button" size="sm" className="h-9 gap-1 bg-pink-600 text-white hover:bg-pink-700" onClick={() => setSaveOpen(true)}>
                <Save className="h-4 w-4" /> {saved ? "Simpan sebagai baru" : "Simpan report"}
              </Button>
            </div>
          }
        >
          {runMutation.isPending && !result ? (
            <div className="py-20 text-center"><Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" /></div>
          ) : result ? (
            <div className={def.chart_type === "table" ? "" : "px-4 py-4"}>
              <ReportResultView result={result} chartType={def.chart_type} height={380} />
            </div>
          ) : (
            <p className="py-20 text-center text-sm text-gray-500">Belum ada hasil.</p>
          )}
        </PurchasingListSection>
      </div>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="sm:max-w-md">
          {saveOpen ? (
            <SaveForm
              defaultName={saved ? `${saved.name} (salinan)` : ""}
              pending={createMutation.isPending}
              onCancel={() => setSaveOpen(false)}
              onSubmit={(v) =>
                createMutation.mutate(
                  { ...v, definition: def },
                  {
                    onSuccess: (body) => {
                      setSaveOpen(false);
                      const id = (body as { id?: string } | undefined)?.id;
                      if (id) onSaved(id);
                    },
                  }
                )
              }
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SaveForm({ defaultName, pending, onCancel, onSubmit }: {
  defaultName: string;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (v: { name: string; description: string | null; is_shared: boolean }) => void;
}) {
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState("");
  const [shared, setShared] = useState(true);
  return (
    <>
      <DialogHeader><DialogTitle>Simpan Report</DialogTitle></DialogHeader>
      <div className="grid gap-3">
        <div className="space-y-1.5"><Label>Nama</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="cth. Pipeline per PIC bulan ini" /></div>
        <div className="space-y-1.5"><Label>Deskripsi (opsional)</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <label className="inline-flex items-center gap-2 text-sm">
          <Switch checked={shared} onCheckedChange={(v) => setShared(Boolean(v))} /> Bagikan ke tim
        </label>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={pending}>Batal</Button>
        <Button disabled={!name.trim() || pending} onClick={() => onSubmit({ name: name.trim(), description: description.trim() || null, is_shared: shared })}>
          {pending ? "Menyimpan…" : "Simpan"}
        </Button>
      </DialogFooter>
    </>
  );
}

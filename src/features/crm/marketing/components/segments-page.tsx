"use client";

import { useState } from "react";
import { UserGroupIcon } from "@heroicons/react/24/outline";
import { Loader2, Plus, RefreshCw, Users, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import {
  RFM_PRESETS,
  SEGMENT_SOURCES,
  SEGMENT_SOURCE_DEFS,
  SEGMENT_SOURCE_LABELS,
  describeSegment,
  matchRfmPreset,
  segmentDefinitionSchema,
} from "@/lib/crm/segments";
import { FILTER_OP_LABELS, FILTER_OPS } from "@/lib/crm/report-builder";
import {
  useCreateSegment, useDeleteSegment, usePreviewDefinition, useRecountSegment, useSegments, useUpdateSegment,
} from "../queries";
import type { SegmentDefinition, SegmentPreview, SegmentRow, SegmentSource } from "../types";
import { formatNumber, formatRupiah } from "@/lib/format";

const emptyDefinition = (source: SegmentSource = "member"): SegmentDefinition => segmentDefinitionSchema.parse({ source });

/** EPIC-050 T-5.1 — Segmen dinamis + RFM, dipakai sebagai penerima kampanye WA. */
export function SegmentsPage() {
  const segmentsQuery = useSegments();
  const recountMutation = useRecountSegment();
  const deleteMutation = useDeleteSegment();
  const updateMutation = useUpdateSegment();
  const [editing, setEditing] = useState<SegmentRow | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [deleting, setDeleting] = useState<SegmentRow | null>(null);
  const segments = segmentsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Segmen</h1>
          <p className="mt-1 text-sm text-gray-500">
            Kelompok pelanggan yang isinya dihitung ulang setiap dipakai. Skor RFM membandingkan pelanggan satu sama lain, jadi 5 selalu berarti paling baik.
          </p>
        </div>
        <Button type="button" className="h-10 gap-2 rounded-lg bg-pink-600 text-white hover:bg-pink-700"
          onClick={() => { setEditing(null); setBuilderOpen(true); }}>
          <Plus className="h-4 w-4" /> Segmen
        </Button>
      </div>

      <PurchasingListSection
        icon={UserGroupIcon}
        title="Daftar Segmen"
        description="Jumlah anggota disimpan dari hitungan terakhir; tekan hitung ulang untuk menyegarkan."
      >
        {segmentsQuery.isLoading ? (
          <div className="py-14 text-center"><Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" /></div>
        ) : segments.length === 0 ? (
          <p className="py-14 text-center text-sm text-gray-500">Belum ada segmen.</p>
        ) : (
          <ul className="divide-y divide-gray-200/60">
            {segments.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <Switch checked={s.is_active} onCheckedChange={(v) => updateMutation.mutate({ id: s.id, values: { is_active: Boolean(v) } })} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-900">{s.name}</p>
                  <p className="text-xs text-gray-500">
                    {describeSegment(s.definition)}
                    {s.description ? ` · ${s.description}` : ""}
                  </p>
                </div>
                {s.last_count !== null ? (
                  <Badge className="border-0 bg-pink-100 font-normal text-pink-700">
                    <Users className="mr-1 h-3 w-3" />{formatNumber(s.last_count)} anggota
                  </Badge>
                ) : (
                  <Badge className="border-0 bg-gray-100 font-normal text-gray-500">belum dihitung</Badge>
                )}
                <button type="button" className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-pink-700"
                  onClick={() => recountMutation.mutate(s.id)} disabled={recountMutation.isPending}>
                  <RefreshCw className="h-3.5 w-3.5" /> Hitung ulang
                </button>
                <button type="button" className="text-xs text-gray-500 hover:text-pink-700"
                  onClick={() => { setEditing(s); setBuilderOpen(true); }}>Edit</button>
                <button type="button" className="text-xs text-gray-400 hover:text-red-600" onClick={() => setDeleting(s)}>Hapus</button>
              </li>
            ))}
          </ul>
        )}
      </PurchasingListSection>

      <Dialog open={builderOpen} onOpenChange={setBuilderOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          {builderOpen ? (
            <SegmentBuilder
              key={editing?.id ?? "new"}
              initial={editing}
              onClose={() => setBuilderOpen(false)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Hapus segmen?"
        description={`"${deleting?.name ?? ""}" dihapus. Kampanye yang sudah terkirim tidak terpengaruh.`}
        confirmLabel="Hapus"
        variant="danger"
        onConfirm={() => { if (deleting) deleteMutation.mutate(deleting.id); setDeleting(null); }}
      />
    </div>
  );
}

function SegmentBuilder({ initial, onClose }: { initial: SegmentRow | null; onClose: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [def, setDef] = useState<SegmentDefinition>(initial?.definition ?? emptyDefinition());
  const [preview, setPreview] = useState<SegmentPreview | null>(null);
  const previewMutation = usePreviewDefinition();
  const createMutation = useCreateSegment();
  const updateMutation = useUpdateSegment();

  const src = SEGMENT_SOURCE_DEFS[def.source];
  const fields = Object.entries(src.fields);
  const activePreset = matchRfmPreset(def.rfm);
  const pending = createMutation.isPending || updateMutation.isPending;

  const patch = (p: Partial<SegmentDefinition>) => { setDef((prev) => ({ ...prev, ...p })); setPreview(null); };

  const runPreview = () => previewMutation.mutate(def, { onSuccess: (r) => setPreview(r) });

  const save = () => {
    const values = { name: name.trim(), description: description.trim() || null, definition: def, is_active: initial?.is_active ?? true };
    if (initial) updateMutation.mutate({ id: initial.id, values }, { onSuccess: onClose });
    else createMutation.mutate(values, { onSuccess: onClose });
  };

  return (
    <>
      <DialogHeader><DialogTitle>{initial ? "Edit Segmen" : "Segmen Baru"}</DialogTitle></DialogHeader>

      <div className="grid gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label>Nama</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="cth. Pelanggan Loyal Bandung" /></div>
          <div className="space-y-1.5">
            <Label>Sumber</Label>
            <Select value={def.source} onValueChange={(v) => { setDef(emptyDefinition(v as SegmentSource)); setPreview(null); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SEGMENT_SOURCES.map((s) => <SelectItem key={s} value={s}>{SEGMENT_SOURCE_LABELS[s]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5"><Label>Deskripsi (opsional)</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>

        {src.supportsRfm ? (
          <div className="rounded-lg border border-gray-200/80 p-3">
            <div className="flex items-center justify-between">
              <Label>Saring dengan RFM</Label>
              <Switch checked={def.rfm.enabled} onCheckedChange={(v) => patch({ rfm: { ...def.rfm, enabled: Boolean(v) } })} />
            </div>
            {def.rfm.enabled ? (
              <>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {Object.entries(RFM_PRESETS).map(([key, p]) => (
                    <button
                      key={key}
                      type="button"
                      title={p.description}
                      onClick={() => patch({ rfm: p.rfm })}
                      className={`rounded-md border px-2.5 py-1 text-xs transition ${activePreset === key ? "border-pink-600 bg-pink-50 font-medium text-pink-700" : "border-gray-200 text-gray-600 hover:border-pink-300"}`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="mt-3 grid grid-cols-3 gap-3">
                  {(["recency", "frequency", "monetary"] as const).map((dim) => (
                    <div key={dim} className="space-y-1">
                      <p className="text-xs font-medium text-gray-700">
                        {dim === "recency" ? "Kebaruan" : dim === "frequency" ? "Frekuensi" : "Belanja"}
                      </p>
                      <div className="flex items-center gap-1">
                        <Input type="number" min={1} max={5} className="h-8 text-center text-xs" value={def.rfm[dim].min}
                          onChange={(e) => patch({ rfm: { ...def.rfm, [dim]: { ...def.rfm[dim], min: Math.min(5, Math.max(1, Number(e.target.value) || 1)) } } })} />
                        <span className="text-xs text-gray-400">–</span>
                        <Input type="number" min={1} max={5} className="h-8 text-center text-xs" value={def.rfm[dim].max}
                          onChange={(e) => patch({ rfm: { ...def.rfm, [dim]: { ...def.rfm[dim], max: Math.min(5, Math.max(1, Number(e.target.value) || 5)) } } })} />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-xs text-gray-500">Skala 1–5 relatif terhadap seluruh pelanggan. 5 = paling baru, paling sering, paling besar.</p>
              </>
            ) : null}
          </div>
        ) : null}

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <Label>Filter tambahan</Label>
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs"
              onClick={() => patch({ filters: [...def.filters, { field: fields[0]?.[0] ?? "", op: "eq", value: "" }] })}>
              + filter
            </Button>
          </div>
          <div className="space-y-2">
            {def.filters.length === 0 ? <p className="text-xs text-gray-500">Tanpa filter tambahan.</p> : null}
            {def.filters.map((f, i) => {
              const meta = src.fields[f.field];
              const needsValue = f.op !== "is_empty" && f.op !== "not_empty";
              return (
                <div key={i} className="flex flex-wrap gap-1.5">
                  <Select value={f.field} onValueChange={(v) => patch({ filters: def.filters.map((x, j) => (j === i ? { ...x, field: v } : x)) })}>
                    <SelectTrigger className="h-8 w-44 bg-white text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{fields.map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={f.op} onValueChange={(v) => patch({ filters: def.filters.map((x, j) => (j === i ? { ...x, op: v as typeof x.op } : x)) })}>
                    <SelectTrigger className="h-8 w-32 bg-white text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{FILTER_OPS.map((o) => <SelectItem key={o} value={o}>{FILTER_OP_LABELS[o]}</SelectItem>)}</SelectContent>
                  </Select>
                  {needsValue ? (
                    meta?.options?.length ? (
                      <Select value={String(f.value ?? "")} onValueChange={(v) => patch({ filters: def.filters.map((x, j) => (j === i ? { ...x, value: v } : x)) })}>
                        <SelectTrigger className="h-8 flex-1 bg-white text-xs"><SelectValue placeholder="pilih" /></SelectTrigger>
                        <SelectContent>{meta.options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                      </Select>
                    ) : (
                      <Input className="h-8 min-w-32 flex-1 bg-white text-xs"
                        type={meta?.type === "number" || meta?.type === "currency" ? "number" : meta?.type === "date" ? "date" : "text"}
                        value={String(f.value ?? "")} placeholder="nilai"
                        onChange={(e) => patch({ filters: def.filters.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
                    )
                  ) : null}
                  <button type="button" className="px-1 text-gray-400 hover:text-red-600"
                    onClick={() => patch({ filters: def.filters.filter((_, j) => j !== i) })}>
                    <X className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <label className="inline-flex items-center gap-2 text-sm">
          <Switch checked={def.require_wa_consent} onCheckedChange={(v) => patch({ require_wa_consent: Boolean(v) })} />
          Hanya yang memberi izin WhatsApp
        </label>

        <div className="rounded-lg border border-gray-200/80 bg-gray-50/60 p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-800">
              {preview ? `${formatNumber(preview.total)} anggota` : "Belum dihitung"}
            </p>
            <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={runPreview} disabled={previewMutation.isPending}>
              {previewMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Hitung
            </Button>
          </div>
          {preview && preview.sample.length > 0 ? (
            <ul className="mt-2 space-y-1 text-xs text-gray-600">
              {preview.sample.slice(0, 5).map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-gray-800">{m.name}</span>
                  <span className="text-gray-400">{m.phone}</span>
                  {preview.with_rfm ? (
                    <span className="text-gray-500">R{m.r_score} F{m.f_score} M{m.m_score} · {formatRupiah(m.total_spent)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : preview ? (
            <p className="mt-2 text-xs text-gray-500">Tidak ada anggota yang cocok.</p>
          ) : null}
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={pending}>Batal</Button>
        <Button onClick={save} disabled={!name.trim() || pending}>{pending ? "Menyimpan…" : "Simpan Segmen"}</Button>
      </DialogFooter>
    </>
  );
}

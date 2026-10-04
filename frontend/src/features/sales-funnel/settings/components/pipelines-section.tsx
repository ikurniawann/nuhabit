"use client";

import { useState } from "react";
import { RectangleStackIcon } from "@heroicons/react/24/outline";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { useCreatePipeline, useCreateStage, usePipelines, useUpdatePipeline } from "../../pipeline/queries";

/** EPIC-050 T-3.1 — Pengaturan Funnel → Pipelines (multi-pipeline + tambah tahap). */
export function PipelinesSection() {
  const [createOpen, setCreateOpen] = useState(false);
  const [stageFor, setStageFor] = useState<{ id: string; name: string } | null>(null);
  const pipelinesQuery = usePipelines(true);
  const updateMutation = useUpdatePipeline();
  const createMutation = useCreatePipeline(() => setCreateOpen(false));
  const addStageMutation = useCreateStage(() => setStageFor(null));
  const [stageName, setStageName] = useState("");
  const [stageProb, setStageProb] = useState("30");
  const pipelines = pipelinesQuery.data ?? [];

  return (
    <>
      <PurchasingListSection
        icon={RectangleStackIcon}
        title="Pipelines"
        description="Tiap jenis penjualan punya urutan tahap & probability sendiri. Pipeline default dipakai deal baru bila tidak dipilih."
        toolbar={
          <Button type="button" size="sm" className="h-9 gap-1 bg-pink-600 text-white hover:bg-pink-700" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Pipeline
          </Button>
        }
      >
        {pipelinesQuery.isLoading ? (
          <div className="py-10 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-pink-600" /></div>
        ) : (
          <ul className="divide-y divide-gray-200/60">
            {pipelines.map((p) => (
              <li key={p.id} className="px-5 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-3">
                  <Switch checked={p.is_active} onCheckedChange={(v) => updateMutation.mutate({ id: p.id, values: { is_active: Boolean(v) } })} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-900">
                      {p.name}
                      {p.is_default ? <Badge className="ml-2 border-0 bg-pink-100 font-normal text-pink-700">default</Badge> : null}
                    </p>
                    <p className="text-xs text-gray-500">{p.description ?? p.code} · {p.open_deals} deal terbuka</p>
                  </div>
                  {!p.is_default ? (
                    <button type="button" className="text-xs text-gray-500 hover:text-pink-700" onClick={() => updateMutation.mutate({ id: p.id, values: { is_default: true } })}>Jadikan default</button>
                  ) : null}
                  <button type="button" className="text-xs text-gray-500 hover:text-pink-700" onClick={() => { setStageFor({ id: p.id, name: p.name }); setStageName(""); setStageProb("30"); }}>+ tahap</button>
                </div>
                <ol className="mt-2 flex flex-wrap gap-1.5">
                  {p.stages.map((s) => (
                    <li key={s.id} className={`rounded-md border px-2 py-0.5 text-xs ${s.is_won ? "border-emerald-200 bg-emerald-50 text-emerald-700" : s.is_lost ? "border-red-200 bg-red-50 text-red-600" : "border-gray-200 bg-white text-gray-700"} ${s.is_active ? "" : "opacity-50 line-through"}`}>
                      {s.name} · {s.probability ?? 0}%
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
        )}
      </PurchasingListSection>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          {createOpen ? <CreatePipelineForm pending={createMutation.isPending} onCancel={() => setCreateOpen(false)} onSubmit={(v) => createMutation.mutate(v)} /> : null}
        </DialogContent>
      </Dialog>

      <Dialog open={stageFor !== null} onOpenChange={(o) => !o && setStageFor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Tambah tahap — {stageFor?.name}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1.5"><Label>Nama tahap</Label><Input value={stageName} onChange={(e) => setStageName(e.target.value)} placeholder="cth. Survey Lokasi" /></div>
            <div className="space-y-1.5"><Label>Probability (%)</Label><Input type="number" min={0} max={100} value={stageProb} onChange={(e) => setStageProb(e.target.value)} /></div>
            <p className="text-xs text-gray-500">Tahap baru diletakkan sebelum Menang/Kalah. Urutan bisa diubah di daftar Tahap Pipeline di bawah.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStageFor(null)}>Batal</Button>
            <Button disabled={!stageName.trim() || addStageMutation.isPending} onClick={() => stageFor && addStageMutation.mutate({ pipeline_id: stageFor.id, name: stageName.trim(), probability: Math.min(100, Math.max(0, Number(stageProb) || 0)) })}>
              Tambah
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CreatePipelineForm({ pending, onCancel, onSubmit }: { pending: boolean; onCancel: () => void; onSubmit: (v: { name: string; description: string | null; stages: Array<{ name: string; probability: number }> }) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [stages, setStages] = useState<Array<{ name: string; probability: string }>>([
    { name: "Prospek", probability: "10" },
    { name: "Penawaran", probability: "40" },
    { name: "Nego", probability: "70" },
  ]);
  const canSubmit = name.trim() && stages.every((s) => s.name.trim());
  return (
    <>
      <DialogHeader><DialogTitle>Pipeline Baru</DialogTitle></DialogHeader>
      <div className="grid gap-3">
        <div className="space-y-1.5"><Label>Nama</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="cth. Resort & Akomodasi" /></div>
        <div className="space-y-1.5"><Label>Deskripsi (opsional)</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <Label>Tahap (Menang & Kalah dibuat otomatis)</Label>
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => setStages([...stages, { name: "", probability: "50" }])}>+ tahap</Button>
          </div>
          <div className="space-y-1.5">
            {stages.map((s, i) => (
              <div key={i} className="grid grid-cols-[1fr_5rem_auto] items-center gap-2">
                <Input value={s.name} onChange={(e) => setStages(stages.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder={`Tahap ${i + 1}`} className="h-9" />
                <Input type="number" min={0} max={100} value={s.probability} onChange={(e) => setStages(stages.map((x, j) => (j === i ? { ...x, probability: e.target.value } : x)))} className="h-9" />
                <button type="button" className="text-gray-400 hover:text-red-600" onClick={() => setStages(stages.filter((_, j) => j !== i))} disabled={stages.length <= 1}><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={pending}>Batal</Button>
        <Button disabled={!canSubmit || pending} onClick={() => onSubmit({ name: name.trim(), description: description.trim() || null, stages: stages.map((s) => ({ name: s.name.trim(), probability: Math.min(100, Math.max(0, Number(s.probability) || 0)) })) })}>
          {pending ? "Menyimpan…" : "Buat Pipeline"}
        </Button>
      </DialogFooter>
    </>
  );
}

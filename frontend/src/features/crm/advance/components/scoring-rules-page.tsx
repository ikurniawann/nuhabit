"use client";

import { useState } from "react";
import { StarIcon } from "@heroicons/react/24/outline";
import { Loader2, Plus, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { SCORING_EVENT_TYPES, SCORING_FIELDS, SCORING_OPERATORS } from "@/lib/crm/scoring";
import {
  useCreateScoringRule,
  useDeleteScoringRule,
  useRecalculateScores,
  useScoringRules,
  useUpdateScoringRule,
} from "../queries";
import type { ScoringRuleInput, ScoringRuleRow } from "../types";

const FIELD_LABELS: Record<(typeof SCORING_FIELDS)[number], string> = {
  source: "Sumber lead",
  org_type: "Jenis instansi",
  temperature: "Suhu (manual)",
  status: "Status lead",
  city: "Kota",
  pic_email: "Email PIC",
  pic_title: "Jabatan PIC",
  account_type: "Jenis account",
  industry: "Industri account",
};
const OP_LABELS: Record<(typeof SCORING_OPERATORS)[number], string> = {
  eq: "=",
  neq: "≠",
  in: "salah satu dari (pisah koma)",
  contains: "mengandung",
  not_empty: "terisi",
  gt: ">",
  lt: "<",
};
const EVENT_LABELS: Record<(typeof SCORING_EVENT_TYPES)[number], string> = {
  task_done: "Task selesai (opsional: jenis telepon/wa/meeting)",
  wa_inbound: "Balasan WA masuk dari PIC",
  deal_created: "Deal dibuat",
  quotation_sent: "Quotation terkirim/diterima",
};

interface FormState {
  name: string;
  kind: "field" | "event";
  field: string;
  operator: string;
  value: string;
  event_type: string;
  window_days: string;
  max_count: string;
  points: string;
  is_active: boolean;
}
const EMPTY: FormState = { name: "", kind: "field", field: "source", operator: "eq", value: "", event_type: "wa_inbound", window_days: "", max_count: "1", points: "10", is_active: true };

function rowToForm(r: ScoringRuleRow): FormState {
  return {
    name: r.name,
    kind: r.kind,
    field: r.field ?? "source",
    operator: r.operator ?? "eq",
    value: Array.isArray(r.value) ? (r.value as string[]).join(", ") : r.value == null ? "" : String(r.value),
    event_type: r.event_type ?? "wa_inbound",
    window_days: r.window_days ? String(r.window_days) : "",
    max_count: String(r.max_count ?? 1),
    points: String(r.points),
    is_active: r.is_active,
  };
}

function formToInput(f: FormState): ScoringRuleInput {
  const base = { name: f.name.trim(), points: Number(f.points) || 0, is_active: f.is_active, sort_order: 0, max_count: Math.max(1, Number(f.max_count) || 1) };
  if (f.kind === "field") {
    const value = f.operator === "in" ? f.value.split(",").map((v) => v.trim()).filter(Boolean) : f.operator === "not_empty" ? null : f.value.trim();
    return { ...base, kind: "field", field: f.field as ScoringRuleInput["field"], operator: f.operator as ScoringRuleInput["operator"], value };
  }
  return {
    ...base,
    kind: "event",
    event_type: f.event_type as ScoringRuleInput["event_type"],
    value: f.event_type === "task_done" && f.value.trim() ? f.value.trim() : null,
    window_days: f.window_days ? Number(f.window_days) : null,
  };
}

function describe(r: ScoringRuleRow): string {
  if (r.kind === "field") {
    const v = Array.isArray(r.value) ? (r.value as string[]).join(", ") : r.value == null ? "" : String(r.value);
    return `${FIELD_LABELS[r.field as keyof typeof FIELD_LABELS] ?? r.field} ${OP_LABELS[r.operator as keyof typeof OP_LABELS] ?? r.operator} ${v}`.trim();
  }
  const sub = typeof r.value === "string" && r.value ? ` (${r.value})` : "";
  return `${EVENT_LABELS[r.event_type as keyof typeof EVENT_LABELS] ?? r.event_type}${sub}${r.window_days ? ` · ${r.window_days} hari` : ""} · maks ${r.max_count}×`;
}

/** EPIC-050 T-2.2 — Pengaturan CRM → Lead Scoring. */
export function ScoringRulesPage() {
  const rulesQuery = useScoringRules();
  const createMutation = useCreateScoringRule();
  const updateMutation = useUpdateScoringRule();
  const deleteMutation = useDeleteScoringRule();
  const recalcMutation = useRecalculateScores();
  const [editing, setEditing] = useState<ScoringRuleRow | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<ScoringRuleRow | null>(null);
  const rules = rulesQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Lead Scoring</h1>
          <p className="mt-1 text-sm text-gray-500">
            Poin otomatis dari sumber, jenis instansi, suhu, dan aktivitas. Hot ≥ 70, Warm ≥ 40. Sinyal email menyusul Fase 7.
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="h-10 gap-2 rounded-lg" onClick={() => recalcMutation.mutate(undefined)} disabled={recalcMutation.isPending}>
            <RefreshCw className={`h-4 w-4 ${recalcMutation.isPending ? "animate-spin" : ""}`} /> Hitung ulang semua lead
          </Button>
          <Button type="button" className="h-10 gap-2 rounded-lg bg-pink-600 text-white hover:bg-pink-700" onClick={() => { setEditing(null); setFormOpen(true); }}>
            <Plus className="h-4 w-4" /> Aturan
          </Button>
        </div>
      </div>

      <PurchasingListSection icon={StarIcon} title="Aturan Poin" description="Skor lead dihitung ulang otomatis setiap ada event (lead diubah, task selesai, WA masuk, deal/quotation).">
        {rulesQuery.isLoading ? (
          <div className="py-14 text-center"><Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" /></div>
        ) : rules.length === 0 ? (
          <p className="py-14 text-center text-sm text-gray-500">Belum ada aturan.</p>
        ) : (
          <ul className="divide-y divide-gray-200/60">
            {rules.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <Switch checked={r.is_active} onCheckedChange={(v) => updateMutation.mutate({ id: r.id, values: { is_active: Boolean(v) } })} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-900">{r.name}</p>
                  <p className="text-xs text-gray-500">{describe(r)}</p>
                </div>
                <Badge className={`border-0 font-semibold ${r.points >= 0 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                  {r.points >= 0 ? "+" : ""}{r.points}
                </Badge>
                <Badge className="border-0 bg-gray-100 font-normal text-gray-600">{r.kind === "field" ? "field" : "event"}</Badge>
                {r.company_id === null ? <Badge className="border-0 bg-violet-100 font-normal text-violet-700">global</Badge> : null}
                <button type="button" className="text-xs text-gray-500 hover:text-pink-700" onClick={() => { setEditing(r); setFormOpen(true); }}>Edit</button>
                <button type="button" className="text-xs text-gray-400 hover:text-red-600" onClick={() => setDeleting(r)}>Hapus</button>
              </li>
            ))}
          </ul>
        )}
      </PurchasingListSection>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-xl">
          {formOpen ? (
            <RuleForm
              key={editing?.id ?? "new"}
              initial={editing ? rowToForm(editing) : EMPTY}
              isEdit={Boolean(editing)}
              pending={createMutation.isPending || updateMutation.isPending}
              onCancel={() => setFormOpen(false)}
              onSubmit={(f) => {
                const input = formToInput(f);
                if (editing) updateMutation.mutate({ id: editing.id, values: input }, { onSuccess: () => setFormOpen(false) });
                else createMutation.mutate(input, { onSuccess: () => setFormOpen(false) });
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Hapus aturan?"
        description={`Aturan "${deleting?.name ?? ""}" dihapus. Skor lead berubah saat dihitung ulang.`}
        confirmLabel="Hapus"
        variant="danger"
        onConfirm={() => { if (deleting) deleteMutation.mutate(deleting.id); setDeleting(null); }}
      />
    </div>
  );
}

function RuleForm({ initial, isEdit, pending, onCancel, onSubmit }: { initial: FormState; isEdit: boolean; pending: boolean; onCancel: () => void; onSubmit: (f: FormState) => void }) {
  const [f, setF] = useState<FormState>(initial);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }));
  const canSubmit = f.name.trim() && f.points !== "" && (f.kind === "event" || f.operator === "not_empty" || f.value.trim());
  return (
    <>
      <DialogHeader><DialogTitle>{isEdit ? "Edit Aturan Scoring" : "Aturan Scoring Baru"}</DialogTitle></DialogHeader>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Nama</Label>
          <Input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="cth. Sumber referral" />
        </div>
        <div className="space-y-1.5">
          <Label>Jenis aturan</Label>
          <Select value={f.kind} onValueChange={(v) => set("kind", v as FormState["kind"])}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="field">Field lead</SelectItem>
              <SelectItem value="event">Kejadian (event)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Poin (boleh negatif)</Label>
          <Input type="number" min={-100} max={100} value={f.points} onChange={(e) => set("points", e.target.value)} />
        </div>
        {f.kind === "field" ? (
          <>
            <div className="space-y-1.5">
              <Label>Field</Label>
              <Select value={f.field} onValueChange={(v) => set("field", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{SCORING_FIELDS.map((x) => <SelectItem key={x} value={x}>{FIELD_LABELS[x]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Operator</Label>
              <Select value={f.operator} onValueChange={(v) => set("operator", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{SCORING_OPERATORS.map((x) => <SelectItem key={x} value={x}>{OP_LABELS[x]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {f.operator !== "not_empty" ? (
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Nilai</Label>
                <Input value={f.value} onChange={(e) => set("value", e.target.value)} placeholder={f.operator === "in" ? "corporate, pemerintah" : "cth. wa / panas / Bandung"} />
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Kejadian</Label>
              <Select value={f.event_type} onValueChange={(v) => set("event_type", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{SCORING_EVENT_TYPES.map((x) => <SelectItem key={x} value={x}>{EVENT_LABELS[x]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {f.event_type === "task_done" ? (
              <div className="space-y-1.5">
                <Label>Jenis task (opsional)</Label>
                <Input value={f.value} onChange={(e) => set("value", e.target.value)} placeholder="meeting / telepon / wa" />
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label>Hanya dalam N hari terakhir (kosong = semua)</Label>
              <Input type="number" min={1} value={f.window_days} onChange={(e) => set("window_days", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Dihitung maksimal (kali)</Label>
              <Input type="number" min={1} max={100} value={f.max_count} onChange={(e) => set("max_count", e.target.value)} />
            </div>
          </>
        )}
        <label className="inline-flex items-center gap-2 text-sm sm:col-span-2">
          <Switch checked={f.is_active} onCheckedChange={(v) => set("is_active", Boolean(v))} /> Aktif
        </label>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={pending}>Batal</Button>
        <Button onClick={() => onSubmit(f)} disabled={!canSubmit || pending}>{pending ? "Menyimpan…" : "Simpan"}</Button>
      </DialogFooter>
    </>
  );
}

"use client";

import { useState } from "react";
import { Cog6ToothIcon } from "@heroicons/react/24/outline";
import { History, Loader2, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { useStages } from "@/features/sales-funnel/pipeline/queries";
import { CONDITION_OPS, UPDATABLE_FIELDS, WORKFLOW_OBJECTS, WORKFLOW_TRIGGERS } from "@/lib/crm/workflow";
import {
  useCreateWorkflowRule,
  useDeleteWorkflowRule,
  useOwners,
  useUpdateWorkflowRule,
  useWorkflowRules,
  useWorkflowRuns,
} from "../queries";
import {
  ACTION_LABELS,
  CONDITION_FIELDS,
  CONDITION_OP_LABELS,
  OBJECT_LABELS,
  TRIGGER_LABELS,
  type WorkflowAction,
  type WorkflowCondition,
  type WorkflowObject,
  type WorkflowRuleRow,
  type WorkflowTrigger,
} from "../types";
import { formatDateTime } from "@/lib/format";

// ── Form state (string-friendly) ──
interface CondForm { field: string; op: WorkflowCondition["op"]; value: string }
type ActForm = Record<string, string | boolean | number>;
interface FormState {
  name: string;
  description: string;
  object: WorkflowObject;
  trigger_type: WorkflowTrigger;
  days: string;
  score: string;
  to_stage: string;
  to_status: string;
  conditions: CondForm[];
  actions: ActForm[];
  run_once_per_record: boolean;
  is_active: boolean;
}
const EMPTY: FormState = {
  name: "", description: "", object: "lead", trigger_type: "created", days: "3", score: "70", to_stage: "", to_status: "",
  conditions: [], actions: [{ type: "notify_in_app", to: "owner", title: "", message: "" }], run_once_per_record: true, is_active: true,
};
const DEFAULT_ACTION: Record<WorkflowAction["type"], ActForm> = {
  send_wa: { type: "send_wa", to: "owner", number: "", message: "" },
  create_task: { type: "create_task", title: "", activity_type: "tugas", notes: "", due_in_days: 1, priority: "normal", assign_to: "owner" },
  assign_owner: { type: "assign_owner", strategy: "fixed", user_id: "", user_ids: "", only_if_empty: true },
  update_field: { type: "update_field", field: "", value: "" },
  notify_in_app: { type: "notify_in_app", to: "owner", user_id: "", role: "", title: "", message: "" },
  webhook: { type: "webhook", url: "", secret: "" },
  wait: { type: "wait", days: 0, hours: 1 },
};

function rowToForm(r: WorkflowRuleRow): FormState {
  return {
    name: r.name, description: r.description ?? "", object: r.object, trigger_type: r.trigger_type,
    days: String(r.trigger_config?.days ?? 3), score: String(r.trigger_config?.score ?? 70),
    to_stage: r.trigger_config?.to_stage ?? "", to_status: r.trigger_config?.to_status ?? "",
    conditions: (r.conditions ?? []).map((c) => ({ field: c.field, op: c.op, value: Array.isArray(c.value) ? c.value.join(", ") : c.value == null ? "" : String(c.value) })),
    actions: (r.actions ?? []).map((a) => {
      const base: ActForm = { ...DEFAULT_ACTION[a.type] };
      for (const [k, v] of Object.entries(a)) base[k] = Array.isArray(v) ? v.join(", ") : v == null ? "" : (v as string | number | boolean);
      return base;
    }),
    run_once_per_record: r.run_once_per_record, is_active: r.is_active,
  };
}

function formToPayload(f: FormState) {
  const trigger_config: Record<string, unknown> = {};
  if (f.trigger_type === "inactive_days" || f.trigger_type === "due_soon") trigger_config.days = Number(f.days) || 1;
  if (f.trigger_type === "score_reached") trigger_config.score = Number(f.score) || 0;
  if (f.trigger_type === "stage_changed" && f.to_stage) trigger_config.to_stage = f.to_stage;
  if (f.trigger_type === "status_changed" && f.to_status) trigger_config.to_status = f.to_status;
  const conditions = f.conditions
    .filter((c) => c.field.trim())
    .map((c) => ({
      field: c.field.trim(),
      op: c.op,
      value: ["in", "not_in"].includes(c.op) ? c.value.split(",").map((v) => v.trim()).filter(Boolean) : ["is_empty", "not_empty", "changed"].includes(c.op) ? null : c.value,
    }));
  const actions = f.actions.map((a) => {
    const t = a.type as WorkflowAction["type"];
    switch (t) {
      case "send_wa": return { type: t, to: a.to, number: a.number || null, message: String(a.message ?? "") };
      case "create_task": return { type: t, title: String(a.title ?? ""), activity_type: a.activity_type, notes: a.notes || null, due_in_days: Number(a.due_in_days) || 0, priority: a.priority, assign_to: String(a.assign_to || "owner") };
      case "assign_owner": return { type: t, strategy: a.strategy, user_id: a.user_id || null, user_ids: String(a.user_ids ?? "").split(",").map((v) => v.trim()).filter(Boolean), only_if_empty: Boolean(a.only_if_empty) };
      case "update_field": return { type: t, field: String(a.field ?? ""), value: a.value === "" ? null : a.value };
      case "notify_in_app": return { type: t, to: a.to, user_id: a.user_id || null, role: a.role || null, title: String(a.title ?? ""), message: String(a.message ?? "") };
      case "webhook": return { type: t, url: String(a.url ?? ""), secret: a.secret || null };
      case "wait": return { type: t, days: Number(a.days) || 0, hours: Number(a.hours) || 0 };
    }
  });
  return {
    name: f.name.trim(), description: f.description.trim() || null, object: f.object, trigger_type: f.trigger_type,
    trigger_config, conditions, actions, run_once_per_record: f.run_once_per_record, is_active: f.is_active,
  };
}

const PLACEHOLDER_HINT = "Placeholder: {{lead.org_name}} {{lead.pic_name}} {{deal.title}} {{owner.name}} {{stage.name}} {{score}} {{task.title}}";

/** EPIC-050 T-2.3 — Pengaturan CRM → Workflow Rules. */
export function WorkflowRulesPage() {
  const rulesQuery = useWorkflowRules();
  const createMutation = useCreateWorkflowRule();
  const updateMutation = useUpdateWorkflowRule();
  const deleteMutation = useDeleteWorkflowRule();
  const [editing, setEditing] = useState<WorkflowRuleRow | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<WorkflowRuleRow | null>(null);
  const [logFor, setLogFor] = useState<WorkflowRuleRow | null>(null);
  const rules = rulesQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Workflow Rules</h1>
          <p className="mt-1 text-sm text-gray-500">Trigger → kondisi → aksi. Aksi: WhatsApp, buat task, tetapkan PJ, ubah field, notifikasi, webhook, tunggu.</p>
        </div>
        <Button type="button" className="h-10 gap-2 rounded-lg bg-pink-600 text-white hover:bg-pink-700" onClick={() => { setEditing(null); setFormOpen(true); }}>
          <Plus className="h-4 w-4" /> Rule
        </Button>
      </div>

      <PurchasingListSection icon={Cog6ToothIcon} title="Daftar Rule" description="Rule berjalan otomatis saat event terjadi; trigger berbasis waktu dicek tiap 5 menit.">
        {rulesQuery.isLoading ? (
          <div className="py-14 text-center"><Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" /></div>
        ) : rules.length === 0 ? (
          <div className="py-14 text-center text-sm text-gray-500">
            Belum ada rule. Contoh: <em>Lead tanpa aktivitas 3 hari → buat task + WA ke PJ</em>.
          </div>
        ) : (
          <ul className="divide-y divide-gray-200/60">
            {rules.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <Switch checked={r.is_active} onCheckedChange={(v) => updateMutation.mutate({ id: r.id, values: { is_active: Boolean(v) } })} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-900">{r.name}</p>
                  <p className="text-xs text-gray-500">
                    {OBJECT_LABELS[r.object]} · {TRIGGER_LABELS[r.trigger_type]}
                    {r.trigger_config?.days ? ` (${r.trigger_config.days} hari)` : ""}
                    {typeof r.trigger_config?.score === "number" ? ` (≥ ${r.trigger_config.score})` : ""}
                    {r.trigger_config?.to_stage ? ` → ${r.trigger_config.to_stage}` : ""}
                    {" · "}{(r.conditions ?? []).length} kondisi · {(r.actions ?? []).map((a) => ACTION_LABELS[a.type]).join(", ")}
                  </p>
                </div>
                <Badge className="border-0 bg-gray-100 font-normal text-gray-600">{r.run_count}× jalan</Badge>
                {r.company_id === null ? <Badge className="border-0 bg-violet-100 font-normal text-violet-700">global</Badge> : null}
                <button type="button" className="text-gray-400 hover:text-pink-700" title="Log eksekusi" onClick={() => setLogFor(r)}><History className="h-4 w-4" /></button>
                <button type="button" className="text-xs text-gray-500 hover:text-pink-700" onClick={() => { setEditing(r); setFormOpen(true); }}>Edit</button>
                <button type="button" className="text-xs text-gray-400 hover:text-red-600" onClick={() => setDeleting(r)}>Hapus</button>
              </li>
            ))}
          </ul>
        )}
      </PurchasingListSection>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          {formOpen ? (
            <RuleForm
              key={editing?.id ?? "new"}
              initial={editing ? rowToForm(editing) : EMPTY}
              isEdit={Boolean(editing)}
              pending={createMutation.isPending || updateMutation.isPending}
              onCancel={() => setFormOpen(false)}
              onSubmit={(f) => {
                const payload = formToPayload(f);
                if (editing) updateMutation.mutate({ id: editing.id, values: payload }, { onSuccess: () => setFormOpen(false) });
                else createMutation.mutate(payload, { onSuccess: () => setFormOpen(false) });
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog open={logFor !== null} onOpenChange={(o) => !o && setLogFor(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>Log — {logFor?.name}</DialogTitle></DialogHeader>
          {logFor ? <RunLog ruleId={logFor.id} /> : null}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Hapus rule?"
        description={`"${deleting?.name ?? ""}" beserta log eksekusinya dihapus.`}
        confirmLabel="Hapus"
        variant="danger"
        onConfirm={() => { if (deleting) deleteMutation.mutate(deleting.id); setDeleting(null); }}
      />
    </div>
  );
}

function RunLog({ ruleId }: { ruleId: string }) {
  const q = useWorkflowRuns(ruleId, true);
  if (q.isLoading) return <div className="py-8 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-pink-600" /></div>;
  const runs = q.data?.runs ?? [];
  const scheduled = q.data?.scheduled ?? [];
  return (
    <div className="space-y-3 text-sm">
      {scheduled.length > 0 ? (
        <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">{scheduled.length} aksi menunggu jadwal (setelah “tunggu”).</p>
      ) : null}
      {runs.length === 0 ? <p className="py-6 text-center text-gray-500">Belum pernah berjalan.</p> : (
        <ul className="divide-y divide-gray-200/60">
          {runs.map((r) => (
            <li key={r.id} className="py-2">
              <div className="flex items-center gap-2">
                <Badge className={`border-0 font-normal ${r.status === "success" ? "bg-emerald-100 text-emerald-700" : r.status === "skipped" ? "bg-gray-100 text-gray-500" : r.status === "scheduled" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>{r.status}</Badge>
                <span className="text-xs text-gray-500">{r.subject_type} {r.subject_id.slice(0, 8)} · {formatDateTime(r.created_at)}</span>
              </div>
              {r.actions_result?.length ? (
                <ul className="mt-1 text-xs text-gray-600">
                  {r.actions_result.map((a, i) => (
                    <li key={i}>• {String(a.type)}: {a.ok ? "ok" : `gagal${a.reason ? ` — ${String(a.reason)}` : ""}`}{a.skipped ? ` (${String(a.skipped)})` : ""}</li>
                  ))}
                </ul>
              ) : null}
              {r.error ? <p className="text-xs text-red-600">{r.error}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RuleForm({ initial, isEdit, pending, onCancel, onSubmit }: { initial: FormState; isEdit: boolean; pending: boolean; onCancel: () => void; onSubmit: (f: FormState) => void }) {
  const [f, setF] = useState<FormState>(initial);
  const stagesQuery = useStages(false);
  const ownersQuery = useOwners();
  const owners = ownersQuery.data ?? [];
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }));
  const setCond = (i: number, patch: Partial<CondForm>) => set("conditions", f.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const setAct = (i: number, patch: ActForm) => set("actions", f.actions.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const canSubmit = f.name.trim() && f.actions.length > 0;

  return (
    <>
      <DialogHeader><DialogTitle>{isEdit ? "Edit Workflow Rule" : "Workflow Rule Baru"}</DialogTitle></DialogHeader>
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Nama</Label>
            <Input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="cth. Lead diam 3 hari → ingatkan PJ" />
          </div>
          <div className="space-y-1.5">
            <Label>Objek</Label>
            <Select value={f.object} onValueChange={(v) => set("object", v as WorkflowObject)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{WORKFLOW_OBJECTS.map((o) => <SelectItem key={o} value={o}>{OBJECT_LABELS[o]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Trigger</Label>
            <Select value={f.trigger_type} onValueChange={(v) => set("trigger_type", v as WorkflowTrigger)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{WORKFLOW_TRIGGERS.map((t) => <SelectItem key={t} value={t}>{TRIGGER_LABELS[t]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {f.trigger_type === "inactive_days" || f.trigger_type === "due_soon" ? (
            <div className="space-y-1.5"><Label>Jumlah hari</Label><Input type="number" min={1} value={f.days} onChange={(e) => set("days", e.target.value)} /></div>
          ) : null}
          {f.trigger_type === "score_reached" ? (
            <div className="space-y-1.5"><Label>Skor ≥</Label><Input type="number" value={f.score} onChange={(e) => set("score", e.target.value)} /></div>
          ) : null}
          {f.trigger_type === "stage_changed" ? (
            <div className="space-y-1.5">
              <Label>Ke tahap (opsional)</Label>
              <Select value={f.to_stage || "any"} onValueChange={(v) => set("to_stage", v === "any" ? "" : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Tahap apa pun</SelectItem>
                  {(stagesQuery.data ?? []).map((s) => <SelectItem key={s.code} value={s.code}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {f.trigger_type === "status_changed" ? (
            <div className="space-y-1.5"><Label>Ke status (opsional)</Label><Input value={f.to_status} onChange={(e) => set("to_status", e.target.value)} placeholder="cth. done / qualified / terkirim" /></div>
          ) : null}
        </div>

        {/* ── Kondisi ── */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <Label>Kondisi (semua harus terpenuhi)</Label>
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => set("conditions", [...f.conditions, { field: CONDITION_FIELDS[f.object][0] ?? "", op: "eq", value: "" }])}>+ kondisi</Button>
          </div>
          {f.conditions.length === 0 ? <p className="text-xs text-gray-500">Tanpa kondisi = selalu berjalan saat trigger.</p> : null}
          <div className="space-y-2">
            {f.conditions.map((c, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2">
                <Input list={`fields-${f.object}`} value={c.field} onChange={(e) => setCond(i, { field: e.target.value })} placeholder="field" className="h-9" />
                <datalist id={`fields-${f.object}`}>{CONDITION_FIELDS[f.object].map((x) => <option key={x} value={x} />)}</datalist>
                <Select value={c.op} onValueChange={(v) => setCond(i, { op: v as WorkflowCondition["op"] })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>{CONDITION_OPS.map((op) => <SelectItem key={op} value={op}>{CONDITION_OP_LABELS[op]}</SelectItem>)}</SelectContent>
                </Select>
                <Input value={c.value} onChange={(e) => setCond(i, { value: e.target.value })} placeholder={["in", "not_in"].includes(c.op) ? "a, b, c" : "nilai"} className="h-9" disabled={["is_empty", "not_empty", "changed"].includes(c.op)} />
                <button type="button" className="text-gray-400 hover:text-red-600" onClick={() => set("conditions", f.conditions.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        </div>

        {/* ── Aksi ── */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <Label>Aksi (berurutan)</Label>
            <Select value="__add" onValueChange={(v) => { if (v !== "__add") set("actions", [...f.actions, { ...DEFAULT_ACTION[v as WorkflowAction["type"]] }]); }}>
              <SelectTrigger className="h-7 w-44 text-xs"><SelectValue placeholder="+ aksi" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__add">+ tambah aksi</SelectItem>
                {(Object.keys(ACTION_LABELS) as WorkflowAction["type"][]).map((t) => <SelectItem key={t} value={t}>{ACTION_LABELS[t]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <p className="mb-2 text-[11px] text-gray-500">{PLACEHOLDER_HINT}</p>
          <div className="space-y-3">
            {f.actions.map((a, i) => {
              const t = a.type as WorkflowAction["type"];
              return (
                <div key={i} className="rounded-xl border border-gray-200/80 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <Badge className="border-0 bg-pink-100 font-semibold text-pink-700">{i + 1}. {ACTION_LABELS[t]}</Badge>
                    <button type="button" className="text-gray-400 hover:text-red-600" onClick={() => set("actions", f.actions.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
                  </div>
                  {t === "send_wa" ? (
                    <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
                      <Select value={String(a.to)} onValueChange={(v) => setAct(i, { to: v })}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="owner">Ke penanggung jawab</SelectItem><SelectItem value="pic">Ke PIC/contact</SelectItem><SelectItem value="number">Ke nomor</SelectItem></SelectContent>
                      </Select>
                      {a.to === "number" ? <Input value={String(a.number ?? "")} onChange={(e) => setAct(i, { number: e.target.value })} placeholder="0812…" className="h-9" /> : <span />}
                      <Textarea value={String(a.message ?? "")} onChange={(e) => setAct(i, { message: e.target.value })} rows={2} placeholder="Pesan WA…" className="sm:col-span-2" />
                    </div>
                  ) : t === "create_task" ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Input value={String(a.title ?? "")} onChange={(e) => setAct(i, { title: e.target.value })} placeholder="Judul task" className="h-9 sm:col-span-2" />
                      <Select value={String(a.activity_type)} onValueChange={(v) => setAct(i, { activity_type: v })}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>{["tugas", "telepon", "wa", "meeting", "email", "catatan"].map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent>
                      </Select>
                      <Select value={String(a.priority)} onValueChange={(v) => setAct(i, { priority: v })}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>{["low", "normal", "high", "urgent"].map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent>
                      </Select>
                      <label className="text-xs text-gray-600">Jatuh tempo +hari<Input type="number" min={0} value={String(a.due_in_days ?? 1)} onChange={(e) => setAct(i, { due_in_days: e.target.value })} className="mt-1 h-9" /></label>
                      <label className="text-xs text-gray-600">Ditugaskan ke
                        <Select value={String(a.assign_to || "owner")} onValueChange={(v) => setAct(i, { assign_to: v })}>
                          <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="owner">Penanggung jawab record</SelectItem>
                            <SelectItem value="creator">Pemicu event</SelectItem>
                            {owners.map((o) => <SelectItem key={o.id} value={o.id}>{o.full_name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </label>
                    </div>
                  ) : t === "assign_owner" ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Select value={String(a.strategy)} onValueChange={(v) => setAct(i, { strategy: v })}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="fixed">User tertentu</SelectItem><SelectItem value="round_robin">Bergiliran (round-robin)</SelectItem></SelectContent>
                      </Select>
                      {a.strategy === "round_robin" ? (
                        <Input value={String(a.user_ids ?? "")} onChange={(e) => setAct(i, { user_ids: e.target.value })} placeholder="ID user dipisah koma" className="h-9" />
                      ) : (
                        <Select value={String(a.user_id || "none")} onValueChange={(v) => setAct(i, { user_id: v === "none" ? "" : v })}>
                          <SelectTrigger className="h-9"><SelectValue placeholder="Pilih user" /></SelectTrigger>
                          <SelectContent><SelectItem value="none">— pilih —</SelectItem>{owners.map((o) => <SelectItem key={o.id} value={o.id}>{o.full_name} · {o.role}</SelectItem>)}</SelectContent>
                        </Select>
                      )}
                      <label className="inline-flex items-center gap-2 text-xs text-gray-600 sm:col-span-2"><Switch checked={Boolean(a.only_if_empty)} onCheckedChange={(v) => setAct(i, { only_if_empty: v })} /> Hanya bila belum punya penanggung jawab</label>
                      {a.strategy === "round_robin" ? <p className="text-[11px] text-gray-500 sm:col-span-2">Kandidat: {owners.map((o) => `${o.full_name}=${o.id}`).join(" · ")}</p> : null}
                    </div>
                  ) : t === "update_field" ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Select value={String(a.field || "none")} onValueChange={(v) => setAct(i, { field: v === "none" ? "" : v })}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="Field" /></SelectTrigger>
                        <SelectContent><SelectItem value="none">— field —</SelectItem>{UPDATABLE_FIELDS[f.object].map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent>
                      </Select>
                      <Input value={String(a.value ?? "")} onChange={(e) => setAct(i, { value: e.target.value })} placeholder="nilai baru" className="h-9" />
                    </div>
                  ) : t === "notify_in_app" ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Select value={String(a.to)} onValueChange={(v) => setAct(i, { to: v })}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="owner">Penanggung jawab</SelectItem><SelectItem value="user">User tertentu</SelectItem><SelectItem value="role">Semua user ber-role</SelectItem></SelectContent>
                      </Select>
                      {a.to === "user" ? (
                        <Select value={String(a.user_id || "none")} onValueChange={(v) => setAct(i, { user_id: v === "none" ? "" : v })}>
                          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="none">— pilih —</SelectItem>{owners.map((o) => <SelectItem key={o.id} value={o.id}>{o.full_name}</SelectItem>)}</SelectContent>
                        </Select>
                      ) : a.to === "role" ? (
                        <Input value={String(a.role ?? "")} onChange={(e) => setAct(i, { role: e.target.value })} placeholder="admin / sales / super_admin" className="h-9" />
                      ) : <span />}
                      <Input value={String(a.title ?? "")} onChange={(e) => setAct(i, { title: e.target.value })} placeholder="Judul notifikasi" className="h-9 sm:col-span-2" />
                      <Textarea value={String(a.message ?? "")} onChange={(e) => setAct(i, { message: e.target.value })} rows={2} placeholder="Isi…" className="sm:col-span-2" />
                    </div>
                  ) : t === "webhook" ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Input value={String(a.url ?? "")} onChange={(e) => setAct(i, { url: e.target.value })} placeholder="https://…" className="h-9" />
                      <Input value={String(a.secret ?? "")} onChange={(e) => setAct(i, { secret: e.target.value })} placeholder="secret (opsional, HMAC-SHA256)" className="h-9" />
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-xs text-gray-600">Hari<Input type="number" min={0} value={String(a.days ?? 0)} onChange={(e) => setAct(i, { days: e.target.value })} className="mt-1 h-9" /></label>
                      <label className="text-xs text-gray-600">Jam<Input type="number" min={0} value={String(a.hours ?? 0)} onChange={(e) => setAct(i, { hours: e.target.value })} className="mt-1 h-9" /></label>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="inline-flex items-center gap-2 text-sm"><Switch checked={f.run_once_per_record} onCheckedChange={(v) => set("run_once_per_record", v)} /> Sekali per record</label>
          <label className="inline-flex items-center gap-2 text-sm"><Switch checked={f.is_active} onCheckedChange={(v) => set("is_active", v)} /> Aktif</label>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Deskripsi (opsional)</Label>
            <Textarea value={f.description} onChange={(e) => set("description", e.target.value)} rows={2} />
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={pending}>Batal</Button>
        <Button onClick={() => onSubmit(f)} disabled={!canSubmit || pending}>{pending ? "Menyimpan…" : "Simpan"}</Button>
      </DialogFooter>
    </>
  );
}

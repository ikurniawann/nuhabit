"use client";

import { useState } from "react";
import { CheckCircleIcon } from "@heroicons/react/24/outline";
import { Loader2, Plus } from "lucide-react";
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
  useApprovalRules,
  useCreateApprovalRule,
  useDeleteApprovalRule,
  useOwners,
  useUpdateApprovalRule,
} from "../queries";
import type { ApprovalRuleInput, ApprovalRuleRow } from "../types";

const ROLES = [
  { value: "admin", label: "Admin / Manajer" },
  { value: "super_admin", label: "Owner (super admin)" },
  { value: "marketing", label: "Marketing" },
  { value: "hrd", label: "HRD" },
];

interface FormState {
  name: string;
  level: string;
  min_discount_percent: string;
  approver_kind: "role" | "user";
  approver_role: string;
  approver_user_id: string;
  is_active: boolean;
}
const EMPTY: FormState = { name: "", level: "1", min_discount_percent: "10", approver_kind: "role", approver_role: "admin", approver_user_id: "", is_active: true };

function rowToForm(r: ApprovalRuleRow): FormState {
  return {
    name: r.name,
    level: String(r.level),
    min_discount_percent: String(Number(r.min_discount_percent)),
    approver_kind: r.approver_user_id ? "user" : "role",
    approver_role: r.approver_role ?? "admin",
    approver_user_id: r.approver_user_id ?? "",
    is_active: r.is_active,
  };
}
function formToInput(f: FormState): ApprovalRuleInput {
  return {
    name: f.name.trim(),
    level: Number(f.level) || 1,
    min_discount_percent: Number(f.min_discount_percent) || 0,
    approver_role: f.approver_kind === "role" ? f.approver_role : null,
    approver_user_id: f.approver_kind === "user" ? f.approver_user_id || null : null,
    is_active: f.is_active,
  };
}

/** EPIC-050 T-2.4 — Pengaturan CRM → Approval Rules (diskon quotation berjenjang). */
export function ApprovalRulesPage() {
  const rulesQuery = useApprovalRules();
  const ownersQuery = useOwners();
  const createMutation = useCreateApprovalRule();
  const updateMutation = useUpdateApprovalRule();
  const deleteMutation = useDeleteApprovalRule();
  const [editing, setEditing] = useState<ApprovalRuleRow | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<ApprovalRuleRow | null>(null);
  const rules = rulesQuery.data ?? [];
  const owners = ownersQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Approval Rules</h1>
          <p className="mt-1 text-sm text-gray-500">
            Diskon quotation di atas ambang wajib disetujui berjenjang sebelum dikirim ke PIC. Default: &gt;10% admin, &gt;20% owner.
          </p>
        </div>
        <Button type="button" className="h-10 gap-2 rounded-lg bg-pink-600 text-white hover:bg-pink-700" onClick={() => { setEditing(null); setFormOpen(true); }}>
          <Plus className="h-4 w-4" /> Aturan
        </Button>
      </div>

      <PurchasingListSection icon={CheckCircleIcon} title="Tingkat Approval" description="Tingkat 1 diputuskan dulu, lalu tingkat berikutnya. Super admin selalu bisa mewakili tingkat di bawahnya.">
        {rulesQuery.isLoading ? (
          <div className="py-14 text-center"><Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" /></div>
        ) : rules.length === 0 ? (
          <p className="py-14 text-center text-sm text-gray-500">Belum ada aturan — semua diskon lolos tanpa approval.</p>
        ) : (
          <ul className="divide-y divide-gray-200/60">
            {rules.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <Switch checked={r.is_active} onCheckedChange={(v) => updateMutation.mutate({ id: r.id, values: { is_active: Boolean(v) } })} />
                <Badge className="border-0 bg-gray-900 font-semibold text-white">Tingkat {r.level}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-900">{r.name}</p>
                  <p className="text-xs text-gray-500">
                    Diskon &gt; {Number(r.min_discount_percent)}% → {r.approver_user_id ? `user ${r.approver_name ?? ""}` : `role ${ROLES.find((x) => x.value === r.approver_role)?.label ?? r.approver_role}`}
                  </p>
                </div>
                {r.company_id === null ? <Badge className="border-0 bg-violet-100 font-normal text-violet-700">global</Badge> : null}
                <button type="button" className="text-xs text-gray-500 hover:text-pink-700" onClick={() => { setEditing(r); setFormOpen(true); }}>Edit</button>
                <button type="button" className="text-xs text-gray-400 hover:text-red-600" onClick={() => setDeleting(r)}>Hapus</button>
              </li>
            ))}
          </ul>
        )}
      </PurchasingListSection>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-lg">
          {formOpen ? (
            <RuleForm
              key={editing?.id ?? "new"}
              initial={editing ? rowToForm(editing) : EMPTY}
              isEdit={Boolean(editing)}
              owners={owners}
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
        title="Hapus aturan approval?"
        description={`"${deleting?.name ?? ""}" dihapus. Request yang sedang berjalan tidak terpengaruh.`}
        confirmLabel="Hapus"
        variant="danger"
        onConfirm={() => { if (deleting) deleteMutation.mutate(deleting.id); setDeleting(null); }}
      />
    </div>
  );
}

function RuleForm({ initial, isEdit, owners, pending, onCancel, onSubmit }: {
  initial: FormState; isEdit: boolean; owners: Array<{ id: string; full_name: string; role: string }>; pending: boolean;
  onCancel: () => void; onSubmit: (f: FormState) => void;
}) {
  const [f, setF] = useState<FormState>(initial);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }));
  const canSubmit = f.name.trim() && (f.approver_kind === "role" ? f.approver_role : f.approver_user_id);
  return (
    <>
      <DialogHeader><DialogTitle>{isEdit ? "Edit Aturan Approval" : "Aturan Approval Baru"}</DialogTitle></DialogHeader>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Nama</Label>
          <Input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="cth. Diskon > 10% — manajer" />
        </div>
        <div className="space-y-1.5">
          <Label>Tingkat (urutan)</Label>
          <Input type="number" min={1} max={5} value={f.level} onChange={(e) => set("level", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Diskon lebih dari (%)</Label>
          <Input type="number" min={0} max={100} step="0.5" value={f.min_discount_percent} onChange={(e) => set("min_discount_percent", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Approver berdasarkan</Label>
          <Select value={f.approver_kind} onValueChange={(v) => set("approver_kind", v as FormState["approver_kind"])}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="role">Role</SelectItem>
              <SelectItem value="user">User tertentu</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{f.approver_kind === "role" ? "Role" : "User"}</Label>
          {f.approver_kind === "role" ? (
            <Select value={f.approver_role} onValueChange={(v) => set("approver_role", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
            </Select>
          ) : (
            <Select value={f.approver_user_id || "none"} onValueChange={(v) => set("approver_user_id", v === "none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Pilih user" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— pilih —</SelectItem>
                {owners.map((o) => <SelectItem key={o.id} value={o.id}>{o.full_name} · {o.role}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>
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

"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Field, TableNote } from "@/features/crm/engagement/components/shared";
import { SELECT } from "@/features/gym/shared";
import { Can } from "@/components/iam/can";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelForm,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  CHANNEL_LABELS,
  commissionApi,
  formatPercent,
  incidentLabel,
  initialSchemeForm,
  parsePercent,
  ROLE_LABELS,
  toSchemeInput,
  type CommissionCoach,
  type CommissionRole,
  type CommissionSchemeRow,
  type CommissionSettingsView,
  type PayoutChannel,
  type SchemeForm,
} from "../commission";
import { commissionKeys } from "./commission-tab";

/** Skema bagi hasil (default dan per cabang) dan peran tiap coach. */
export function CommissionSettingsTab() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: commissionKeys.settings, queryFn: commissionApi.settings });
  const [editing, setEditing] = useState<CommissionSchemeRow | "new" | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: commissionKeys.all });
  const remove = useMutation({
    mutationFn: (id: string) => commissionApi.deleteScheme(id),
    onSuccess: () => {
      toast.success("Skema cabang dihapus");
      refresh();
    },
    onError: (error) => toast.error("Skema gagal dihapus", { description: error.message }),
  });

  if (query.isLoading) return <TableNote>Memuat skema bagi hasil…</TableNote>;
  if (query.error || !query.data) return <TableNote tone="danger">{query.error?.message ?? "Gagal memuat"}</TableNote>;
  const view = query.data;
  const taken = new Set(view.schemes.map((s) => s.branchId).filter(Boolean));

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold">Skema bagi hasil</h3>
            <p className="text-sm text-muted-foreground">
              Pool = persen pendapatan kelas + persen pendapatan PT yang diakui di cabang tersebut. Skema cabang menggantikan default;
              skema cabang yang nonaktif mematikan bagi hasil di cabang itu.
            </p>
          </div>
          <Can menu="gym.incentives" action="create">
            <Button size="sm" onClick={() => setEditing("new")} disabled={taken.size >= view.branches.length}>
              <Plus /> Skema cabang
            </Button>
          </Can>
        </div>
        <Card className="overflow-x-auto py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cakupan</TableHead>
                <TableHead>Pool</TableHead>
                <TableHead className="hidden md:table-cell">Porsi per peran</TableHead>
                <TableHead className="hidden lg:table-cell">Potongan</TableHead>
                <TableHead>Pembayaran</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.schemes.map((s) => (
                <TableRow key={s.id} className={s.isActive ? undefined : "opacity-60"}>
                  <TableCell className="whitespace-normal">
                    <p className="font-medium">{s.branchId ? s.branchName : "Default semua cabang"}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.name} · {s.isActive ? "aktif" : "nonaktif"}
                    </p>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatPercent(s.classPoolPercent)} kelas · {formatPercent(s.ptPoolPercent)} PT
                  </TableCell>
                  <TableCell className="hidden tabular-nums md:table-cell">
                    HC {formatPercent(s.shareHeadCoachPercent)} · Coach {formatPercent(s.shareCoachPercent)} · Asisten{" "}
                    {formatPercent(s.shareAssistantPercent)}
                  </TableCell>
                  <TableCell className="hidden max-w-[18rem] whitespace-normal text-xs lg:table-cell">
                    {Object.entries(s.deductionPercents)
                      .map(([kind, pct]) => `${incidentLabel(kind)} ${formatPercent(pct)}`)
                      .join(" · ")}
                    <span className="block text-muted-foreground">Maks {formatPercent(s.maxDeductionPercent)} per bulan</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={s.payoutChannel === "payroll" ? "info" : "outline"}>{CHANNEL_LABELS[s.payoutChannel]}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Can menu="gym.incentives" action="update">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(s)} aria-label={`Ubah ${s.name}`}>
                          <Pencil />
                        </Button>
                      </Can>
                      {s.branchId && (
                        <Can menu="gym.incentives" action="delete">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-danger"
                            disabled={remove.isPending}
                            onClick={() => remove.mutate(s.id)}
                            aria-label={`Hapus ${s.name}`}
                          >
                            <Trash2 />
                          </Button>
                        </Can>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </section>

      <CoachRoles coaches={view.coaches} onSaved={refresh} />

      {editing && (
        <SchemeDialog
          scheme={editing === "new" ? null : editing}
          view={view}
          taken={taken}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

function CoachRoles({ coaches, onSaved }: { coaches: CommissionCoach[]; onSaved: () => void }) {
  const active = coaches.filter((c) => c.status === "active");
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-base font-semibold">Peran coach</h3>
        <p className="text-sm text-muted-foreground">
          Porsi tiap coach mengikuti perannya. Isi override untuk porsi khusus; kosongkan untuk kembali ke porsi peran.
        </p>
      </div>
      <Card className="divide-y divide-border py-0">
        {active.length === 0 ? (
          <TableNote>Belum ada coach aktif.</TableNote>
        ) : (
          active.map((c) => <CoachRoleRow key={c.id} coach={c} onSaved={onSaved} />)
        )}
      </Card>
    </section>
  );
}

function CoachRoleRow({ coach, onSaved }: { coach: CommissionCoach; onSaved: () => void }) {
  const [role, setRole] = useState<CommissionRole>(coach.role);
  const [share, setShare] = useState(coach.sharePercent === null ? "" : String(coach.sharePercent));
  const shareValue = share.trim() === "" ? null : parsePercent(share);
  const dirty = role !== coach.role || shareValue !== coach.sharePercent;
  const save = useMutation({
    mutationFn: () => commissionApi.saveCoach(coach.id, role, shareValue),
    onSuccess: () => {
      toast.success("Peran coach disimpan", { description: coach.name });
      onSaved();
    },
    onError: (error) => toast.error("Peran coach gagal disimpan", { description: error.message }),
  });
  const invalid = share.trim() !== "" && shareValue === null;

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <p className="min-w-40 flex-1 font-medium">{coach.name}</p>
      <select
        className={`${SELECT} w-44`}
        value={role}
        onChange={(e) => setRole(e.target.value as CommissionRole)}
        aria-label={`Peran ${coach.name}`}
      >
        {(Object.keys(ROLE_LABELS) as CommissionRole[]).map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </select>
      <Input
        value={share}
        onChange={(e) => setShare(e.target.value)}
        placeholder="Ikut peran"
        inputMode="decimal"
        className="w-28"
        aria-label={`Override porsi ${coach.name} (%)`}
        aria-invalid={invalid}
      />
      <Can menu="gym.incentives" action="update">
        <Button size="sm" variant="soft" disabled={!dirty || invalid || save.isPending} onClick={() => save.mutate()}>
          Simpan
        </Button>
      </Can>
    </div>
  );
}

function SchemeDialog({
  scheme,
  view,
  taken,
  onClose,
  onSaved,
}: {
  scheme: CommissionSchemeRow | null;
  view: CommissionSettingsView;
  taken: Set<string | null>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isDefault = scheme !== null && scheme.branchId === null;
  const [form, setForm] = useState<SchemeForm>(() => initialSchemeForm(scheme, view.defaults));
  const field = (key: Exclude<keyof SchemeForm, "deductions" | "is_active" | "payout_channel">) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [key]: e.target.value }),
  });
  const input = toSchemeInput(form, scheme?.id, isDefault);
  const save = useMutation({
    mutationFn: () => {
      if (typeof input === "string") throw new Error(input);
      return commissionApi.saveScheme(input);
    },
    onSuccess: () => {
      toast.success("Skema bagi hasil disimpan", { description: form.name });
      onSaved();
      onClose();
    },
    onError: (error) => toast.error("Skema gagal disimpan", { description: error.message }),
  });
  const branches = view.branches.filter((b) => b.id === scheme?.branchId || !taken.has(b.id));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="lg">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>{scheme ? `Ubah ${scheme.name}` : "Skema bagi hasil cabang"}</DialogPanelTitle>
            <DialogPanelDescription>
              Porsi per orang tetap: bila totalnya di bawah 100%, sisa pool tetap jadi pendapatan perusahaan. Porsi coach yang mengajar
              di beberapa cabang dibagi menurut jumlah sesinya di tiap cabang.
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="grid gap-4 sm:grid-cols-2">
            {!isDefault && (
              <Field label="Cabang">
                <select className={SELECT} {...field("branch_id")} required disabled={scheme !== null}>
                  <option value="">Pilih cabang</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Nama skema" className={isDefault ? "sm:col-span-2" : undefined}>
              <Input {...field("name")} required minLength={2} maxLength={80} />
            </Field>
            <Field label="Pool pendapatan kelas (%)">
              <Input {...field("class_pool_percent")} inputMode="decimal" required />
            </Field>
            <Field label="Pool pendapatan PT (%)">
              <Input {...field("pt_pool_percent")} inputMode="decimal" required />
            </Field>
            <Field label="Porsi head coach (%)">
              <Input {...field("share_head_coach_percent")} inputMode="decimal" required />
            </Field>
            <Field label="Porsi coach (%)">
              <Input {...field("share_coach_percent")} inputMode="decimal" required />
            </Field>
            <Field label="Porsi asisten coach (%)">
              <Input {...field("share_assistant_percent")} inputMode="decimal" required />
            </Field>
            <Field label="Pembayaran">
              <select
                className={SELECT}
                value={form.payout_channel}
                onChange={(e) => setForm({ ...form, payout_channel: e.target.value as PayoutChannel })}
              >
                <option value="payroll">{CHANNEL_LABELS.payroll}: masuk slip gaji</option>
                <option value="direct">{CHANNEL_LABELS.direct}: tunai atau transfer</option>
              </select>
            </Field>
            <fieldset className="space-y-3 rounded-2xl border border-border p-4 sm:col-span-2">
              <legend className="px-1 text-sm font-medium">Potongan disiplin per kejadian (% dari komisi kotor)</legend>
              <div className="grid gap-3 sm:grid-cols-3">
                {Object.keys(form.deductions).map((kind) => (
                  <Field key={kind} label={incidentLabel(kind)}>
                    <Input
                      value={form.deductions[kind]}
                      onChange={(e) => setForm({ ...form, deductions: { ...form.deductions, [kind]: e.target.value } })}
                      inputMode="decimal"
                      required
                    />
                  </Field>
                ))}
              </div>
              <Field label="Potongan maksimal per bulan (%)">
                <Input {...field("max_deduction_percent")} inputMode="decimal" required className="sm:w-40" />
              </Field>
            </fieldset>
            <label className="flex items-center gap-3 text-sm sm:col-span-2">
              <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
              Skema aktif
            </label>
            {typeof input === "string" && form.name.trim().length >= 2 && (
              <p className="text-sm text-danger sm:col-span-2">{input}</p>
            )}
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" disabled={typeof input === "string" || save.isPending}>
              Simpan skema
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}

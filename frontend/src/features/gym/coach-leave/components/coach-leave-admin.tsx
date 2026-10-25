"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Field, TableNote } from "@/features/crm/engagement/components/shared";
import { useIamAccess } from "@/components/iam/iam-access-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SELECT } from "@/features/gym/shared";
import { useGymBranches } from "@/features/gym/branches";
import { COACH_LEAVE_KEYS, coachLeaveApi, INCIDENT_LABEL, LEAVE_TYPE_LABEL, LEAVE_TYPES, type Settings } from "../api";

/** Tanggal tanpa cuti coach (event, launching), per cabang atau semua cabang. */
export function BlackoutsPanel() {
  const queryClient = useQueryClient();
  const manage = useIamAccess().can("gym.coach-leave", "update");
  const branches = useGymBranches();
  const list = useQuery({ queryKey: COACH_LEAVE_KEYS.blackouts, queryFn: coachLeaveApi.blackouts });
  const [form, setForm] = useState({ branch_id: "", date_from: "", date_to: "", reason: "" });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: COACH_LEAVE_KEYS.all });
  const add = useMutation({
    mutationFn: () =>
      coachLeaveApi.addBlackout({
        branch_id: form.branch_id || null,
        date_from: form.date_from,
        date_to: form.date_to || form.date_from,
        reason: form.reason.trim(),
      }),
    onSuccess: () => {
      toast.success("Blackout ditambahkan");
      setForm({ branch_id: "", date_from: "", date_to: "", reason: "" });
      refresh();
    },
    onError: (error) => toast.error("Gagal menambah blackout", { description: error.message }),
  });
  const del = useMutation({
    mutationFn: coachLeaveApi.deleteBlackout,
    onSuccess: () => {
      toast.success("Blackout dihapus");
      refresh();
    },
    onError: (error) => toast.error("Gagal menghapus", { description: error.message }),
  });
  const rows = list.data ?? [];

  return (
    <div className="space-y-4">
      {manage && (
        <Card className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-4">
          <Field label="Cabang">
            <select className={SELECT} value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}>
              <option value="">Semua cabang</option>
              {branches.data?.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Dari">
            <Input type="date" value={form.date_from} onChange={(e) => setForm({ ...form, date_from: e.target.value })} />
          </Field>
          <Field label="Sampai" hint="Kosongkan untuk satu hari. Paling lama 31 hari.">
            <Input type="date" value={form.date_to} onChange={(e) => setForm({ ...form, date_to: e.target.value })} />
          </Field>
          <Field label="Alasan">
            <Input value={form.reason} placeholder="HYROX Jakarta" onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </Field>
          <div className="sm:col-span-4">
            <Button disabled={!form.date_from || form.reason.trim().length < 3 || add.isPending} onClick={() => add.mutate()}>
              Tambah blackout
            </Button>
          </div>
        </Card>
      )}
      <Card className="py-0">
        {list.isLoading ? (
          <TableNote>Memuat blackout…</TableNote>
        ) : list.error ? (
          <TableNote tone="danger">{list.error.message}</TableNote>
        ) : rows.length === 0 ? (
          <TableNote>Belum ada tanggal blackout yang akan datang.</TableNote>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <span className="min-w-0">
                  <span className="block font-medium">{b.date_from === b.date_to ? b.date_from : `${b.date_from} s.d. ${b.date_to}`}</span>
                  <span className="block text-xs text-muted-foreground">
                    {b.reason} · {b.branch_name ?? "Semua cabang"}
                  </span>
                </span>
                {manage && (
                  <Button size="icon-sm" variant="ghost" aria-label="Hapus blackout" disabled={del.isPending} onClick={() => del.mutate(b.id)}>
                    <Trash2 />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="text-xs text-muted-foreground">
        Jenis cuti yang terkena blackout diatur di Pengaturan. Coach tetap bisa mengajukan dengan permintaan pengecualian; Program Director
        menulis alasannya saat menyetujui.
      </p>
    </div>
  );
}

/** Approver cadangan, minimal pemberitahuan per jenis cuti, batas jawaban pengganti, ambang SP dan potongan. */
export function SettingsPanel() {
  const queryClient = useQueryClient();
  const manage = useIamAccess().can("gym.coach-leave", "update");
  const data = useQuery({ queryKey: COACH_LEAVE_KEYS.settings, queryFn: coachLeaveApi.settings });
  if (data.isLoading) return <TableNote>Memuat pengaturan…</TableNote>;
  if (data.error) return <TableNote tone="danger">{data.error.message}</TableNote>;
  if (!data.data) return null;
  return (
    <SettingsForm
      key={JSON.stringify(data.data.settings)}
      initial={data.data.settings}
      users={data.data.users}
      readOnly={!manage}
      onSaved={() => void queryClient.invalidateQueries({ queryKey: COACH_LEAVE_KEYS.all })}
    />
  );
}

function SettingsForm({
  initial,
  users,
  readOnly,
  onSaved,
}: {
  initial: Settings;
  users: { id: string; full_name: string }[];
  readOnly: boolean;
  onSaved: () => void;
}) {
  const [s, setS] = useState(initial);
  const save = useMutation({
    mutationFn: () => coachLeaveApi.saveSettings(s),
    onSuccess: () => {
      toast.success("Pengaturan disimpan");
      onSaved();
    },
    onError: (error) => toast.error("Gagal menyimpan", { description: error.message }),
  });
  const num = (v: string) => (v === "" ? 0 : Number(v));
  const rule = (type: string, patch: Partial<Settings["notice_rules"][string]>) =>
    setS({ ...s, notice_rules: { ...s.notice_rules, [type]: { ...s.notice_rules[type], ...patch } } });

  return (
    <fieldset disabled={readOnly} className="space-y-4">
      <Card className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
        <Field label="Approver cadangan" hint="Memutus cuti coach bila tidak ada Program Director yang tersedia (cuti, atau yang mengajukan).">
          <select
            className={SELECT}
            value={s.backup_approver_user_id ?? ""}
            onChange={(e) => setS({ ...s, backup_approver_user_id: e.target.value || null })}
          >
            <option value="">Tidak ada</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Batas jawaban pengganti (jam)" hint="Lewat batas ini permintaan kembali butuh pengganti. Paling lambat 1 jam sebelum sesi.">
          <Input
            type="number"
            min={1}
            max={72}
            value={s.substitute_response_hours}
            onChange={(e) => setS({ ...s, substitute_response_hours: num(e.target.value) })}
          />
        </Field>
        <Field label="Usulan SP setelah (kejadian)">
          <Input
            type="number"
            min={1}
            max={20}
            value={s.warning_threshold}
            onChange={(e) => setS({ ...s, warning_threshold: num(e.target.value) })}
          />
        </Field>
        <Field label="Dalam periode (hari)">
          <Input
            type="number"
            min={7}
            max={365}
            value={s.warning_window_days}
            onChange={(e) => setS({ ...s, warning_window_days: num(e.target.value) })}
          />
        </Field>
      </Card>

      <Card className="p-5">
        <p className="mb-3 text-sm font-semibold">Minimal pemberitahuan cuti coach</p>
        <div className="space-y-2">
          {LEAVE_TYPES.map((type) => {
            const r = s.notice_rules[type];
            if (!r) return null;
            return (
              <div key={type} className="grid grid-cols-1 items-center gap-2 rounded-2xl bg-surface-2 px-3 py-2 sm:grid-cols-[1fr_8rem_auto_auto]">
                <span className="text-sm font-medium">{LEAVE_TYPE_LABEL[type]}</span>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  H-
                  <Input type="number" min={0} max={90} value={r.min_days} onChange={(e) => rule(type, { min_days: num(e.target.value) })} />
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <Switch checked={r.allow_short_notice} onCheckedChange={(v) => rule(type, { allow_short_notice: v })} />
                  Boleh mendadak
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <Switch checked={r.blackout} onCheckedChange={(v) => rule(type, { blackout: v })} />
                  Kena blackout
                </label>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Di bawah H-N pengajuan ditolak, kecuali &ldquo;Boleh mendadak&rdquo; aktif: pengajuan diterima dan tercatat sebagai cuti mendadak.
        </p>
      </Card>

      <Card className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-3">
        {Object.keys(INCIDENT_LABEL).map((kind) => (
          <Field key={kind} label={`Potongan komisi: ${INCIDENT_LABEL[kind]} (%)`}>
            <Input
              type="number"
              min={0}
              max={100}
              value={s.deduction_percent[kind] ?? 0}
              onChange={(e) => setS({ ...s, deduction_percent: { ...s.deduction_percent, [kind]: num(e.target.value) } })}
            />
          </Field>
        ))}
      </Card>
      {!readOnly && (
        <Button disabled={save.isPending} onClick={() => save.mutate()}>
          Simpan pengaturan
        </Button>
      )}
    </fieldset>
  );
}

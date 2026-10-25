"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Field, TableNote } from "@/features/crm/engagement/components/shared";
import { useIamAccess } from "@/components/iam/iam-access-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatNumber } from "@/lib/format";
import { localDay } from "@/lib/timezone";
import { SELECT } from "@/features/gym/shared";
import { GYM_KEYS, schedulingApi } from "@/features/gym/scheduling/api";
import { COACH_LEAVE_KEYS, coachLeaveApi, INCIDENT_LABEL, type Incident, type Warning } from "../api";

const WARNING_BADGE: Record<Warning["status"], { label: string; variant: "warning" | "destructive" | "muted" }> = {
  proposed: { label: "Diusulkan", variant: "warning" },
  issued: { label: "Diterbitkan", variant: "destructive" },
  dismissed: { label: "Diabaikan", variant: "muted" },
};

/** Kejadian disiplin coach dan usulan SP otomatis. Dilihat Program Director dan HR. */
export function DisciplinePanel() {
  const queryClient = useQueryClient();
  const manage = useIamAccess().can("gym.coach-leave", "update");
  const incidents = useQuery({ queryKey: COACH_LEAVE_KEYS.incidents, queryFn: () => coachLeaveApi.incidents() });
  const warnings = useQuery({ queryKey: COACH_LEAVE_KEYS.warnings, queryFn: coachLeaveApi.warnings });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: COACH_LEAVE_KEYS.all });

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <p className="mb-3 text-sm font-semibold">Usulan SP</p>
        {warnings.isLoading ? (
          <TableNote>Memuat…</TableNote>
        ) : warnings.error ? (
          <TableNote tone="danger">{warnings.error.message}</TableNote>
        ) : (warnings.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada usulan SP.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {(warnings.data ?? []).map((w) => (
              <WarningRow key={w.id} warning={w} manage={manage} onDone={refresh} />
            ))}
          </ul>
        )}
      </Card>
      {manage && <RecordIncident onDone={refresh} />}
      <Card className="py-0">
        {incidents.isLoading ? (
          <TableNote>Memuat kejadian…</TableNote>
        ) : incidents.error ? (
          <TableNote tone="danger">{incidents.error.message}</TableNote>
        ) : (incidents.data ?? []).length === 0 ? (
          <TableNote>Belum ada kejadian disiplin.</TableNote>
        ) : (
          <ul className="divide-y divide-border">
            {(incidents.data ?? []).map((i) => (
              <IncidentRow key={i.id} incident={i} manage={manage} onDone={refresh} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function WarningRow({ warning: w, manage, onDone }: { warning: Warning; manage: boolean; onDone: () => void }) {
  const [note, setNote] = useState("");
  const decide = useMutation({
    mutationFn: (action: "issue" | "dismiss") => coachLeaveApi.decideWarning(w.id, action, note),
    onSuccess: (_, action) => {
      toast.success(action === "issue" ? `SP${w.level} diterbitkan` : "Usulan diabaikan");
      onDone();
    },
    onError: (error) => toast.error("Gagal", { description: error.message }),
  });
  const badge = WARNING_BADGE[w.status];
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-surface-2 px-3 py-2">
      <span className="min-w-0 text-sm">
        <span className="font-medium">
          SP{w.level} · {w.coach_name}
        </span>
        <span className="block text-xs text-muted-foreground">
          {formatNumber(w.incident_ids.length)} kejadian, {w.window_from} s.d. {w.window_to}
          {w.decision_note && ` · ${w.decision_note}`}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        <Badge variant={badge.variant}>{badge.label}</Badge>
        {manage && w.status === "proposed" && (
          <>
            <Input className="h-8 w-44" placeholder="Catatan" value={note} onChange={(e) => setNote(e.target.value)} />
            <Button size="xs" variant="ink" disabled={decide.isPending} onClick={() => decide.mutate("issue")}>
              Terbitkan
            </Button>
            <Button size="xs" variant="ghost" disabled={decide.isPending} onClick={() => decide.mutate("dismiss")}>
              Abaikan
            </Button>
          </>
        )}
      </span>
    </li>
  );
}

function IncidentRow({ incident: i, manage, onDone }: { incident: Incident; manage: boolean; onDone: () => void }) {
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const voidIt = useMutation({
    mutationFn: () => coachLeaveApi.voidIncident(i.id, reason.trim()),
    onSuccess: () => {
      toast.success("Kejadian dibatalkan");
      setVoiding(false);
      onDone();
    },
    onError: (error) => toast.error("Gagal", { description: error.message }),
  });
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
      <span className="min-w-0 text-sm">
        <span className="font-medium">{i.coach_name}</span> · {INCIDENT_LABEL[i.kind] ?? i.kind}
        {i.minutes_late ? ` ${formatNumber(i.minutes_late)} menit` : ""}
        <span className="block text-xs text-muted-foreground">
          {i.occurred_on} · potongan {formatNumber(i.deduction_percent)}%{i.note && ` · ${i.note}`}
          {i.void_reason && ` · dibatalkan: ${i.void_reason}`}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        {i.status === "void" ? <Badge variant="muted">Dibatalkan</Badge> : <Badge variant="warning">Aktif</Badge>}
        {manage && i.status === "active" && !voiding && (
          <Button size="xs" variant="ghost" onClick={() => setVoiding(true)}>
            Batalkan
          </Button>
        )}
        {voiding && (
          <>
            <Input className="h-8 w-48" placeholder="Alasan pembatalan" value={reason} onChange={(e) => setReason(e.target.value)} />
            <Button size="xs" variant="destructive" disabled={reason.trim().length < 5 || voidIt.isPending} onClick={() => voidIt.mutate()}>
              Simpan
            </Button>
          </>
        )}
      </span>
    </li>
  );
}

function RecordIncident({ onDone }: { onDone: () => void }) {
  const coaches = useQuery({ queryKey: GYM_KEYS.coaches, queryFn: schedulingApi.coaches });
  const [form, setForm] = useState({ coach_id: "", kind: "no_show", occurred_on: localDay(new Date()), minutes_late: "", note: "" });
  const save = useMutation({
    mutationFn: () =>
      coachLeaveApi.recordIncident({
        coach_id: form.coach_id,
        kind: form.kind,
        occurred_on: form.occurred_on,
        minutes_late: form.kind === "late" ? Number(form.minutes_late) : undefined,
        note: form.note,
      }),
    onSuccess: () => {
      toast.success("Kejadian dicatat");
      setForm({ ...form, coach_id: "", minutes_late: "", note: "" });
      onDone();
    },
    onError: (error) => toast.error("Gagal mencatat", { description: error.message }),
  });
  const valid = form.coach_id && form.occurred_on && (form.kind !== "late" || Number(form.minutes_late) > 0);
  return (
    <Card className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-5">
      <Field label="Coach">
        <select className={SELECT} value={form.coach_id} onChange={(e) => setForm({ ...form, coach_id: e.target.value })}>
          <option value="">Pilih coach</option>
          {(coaches.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Kejadian">
        <select className={SELECT} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
          <option value="no_show">{INCIDENT_LABEL.no_show}</option>
          <option value="late">{INCIDENT_LABEL.late}</option>
        </select>
      </Field>
      <Field label="Tanggal">
        <Input type="date" value={form.occurred_on} onChange={(e) => setForm({ ...form, occurred_on: e.target.value })} />
      </Field>
      {form.kind === "late" ? (
        <Field label="Terlambat (menit)">
          <Input type="number" min={1} value={form.minutes_late} onChange={(e) => setForm({ ...form, minutes_late: e.target.value })} />
        </Field>
      ) : (
        <div className="hidden sm:block" />
      )}
      <Field label="Catatan">
        <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
      </Field>
      <div className="sm:col-span-5">
        <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>
          Catat kejadian
        </Button>
      </div>
    </Card>
  );
}

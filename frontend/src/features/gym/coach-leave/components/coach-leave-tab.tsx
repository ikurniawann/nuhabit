"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Field, TableNote } from "@/features/crm/engagement/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatNumber } from "@/lib/format";
import { SELECT } from "@/features/gym/shared";
import { rentangJam, tanggal } from "@/features/gym/scheduling/api";
import {
  COACH_LEAVE_KEYS,
  coachLeaveApi,
  LEAVE_STATUS_BADGE,
  LEAVE_TYPE_LABEL,
  LEAVE_TYPES,
  leaveRange,
  type Cover,
  type Portal,
} from "../api";
import { CoverList, CoverRow, SubstituteDialog } from "./cover-list";

/**
 * Kelas Saya → Cuti: ajukan cuti dengan pratinjau kelas dan PT yang
 * terdampak, minta pengganti dari coach yang bebas, dan jawab permintaan
 * menggantikan dari coach lain.
 */
export function CoachLeaveTab() {
  const queryClient = useQueryClient();
  const portal = useQuery({ queryKey: COACH_LEAVE_KEYS.portal, queryFn: coachLeaveApi.portal, refetchInterval: 60_000 });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: COACH_LEAVE_KEYS.portal });

  if (portal.isLoading) return <TableNote>Memuat cuti…</TableNote>;
  if (portal.error) return <TableNote tone="danger">{portal.error.message}</TableNote>;
  const p = portal.data;
  if (!p?.coach) return <TableNote>Akun ini belum tertaut ke profil coach.</TableNote>;

  return (
    <div className="space-y-4">
      <Incoming covers={p.incoming} onDone={refresh} />
      {p.has_employee ? (
        <LeaveForm portal={p} onDone={refresh} />
      ) : (
        <Card className="p-5 text-sm text-body">
          Akun ini belum terhubung ke data karyawan, jadi cuti belum bisa diajukan dari sini. Minta HR menautkan akunmu.
        </Card>
      )}
      <MyLeaves portal={p} onDone={refresh} />
    </div>
  );
}

function Incoming({ covers, onDone }: { covers: Cover[]; onDone: () => void }) {
  const respond = useMutation({
    mutationFn: ({ id, accept }: { id: string; accept: boolean }) => coachLeaveApi.respond(id, accept),
    onSuccess: (_, { accept }) => {
      toast.success(accept ? "Kamu menerima permintaan ini" : "Permintaan ditolak");
      onDone();
    },
    onError: (error) => toast.error("Gagal menjawab", { description: error.message }),
  });
  if (covers.length === 0) return null;
  return (
    <Card className="space-y-3 p-5">
      <p className="text-sm font-semibold">Permintaan menggantikan</p>
      <ul className="flex flex-col gap-1.5">
        {covers.map((c) => (
          <CoverRow
            key={c.id}
            cover={{ ...c, substitute_name: null }}
            actions={
              c.status === "requested" ? (
                <>
                  <span className="text-xs text-muted-foreground">dari {c.coach_name}</span>
                  <Button size="xs" disabled={respond.isPending} onClick={() => respond.mutate({ id: c.id, accept: true })}>
                    Terima
                  </Button>
                  <Button size="xs" variant="ghost" disabled={respond.isPending} onClick={() => respond.mutate({ id: c.id, accept: false })}>
                    Tolak
                  </Button>
                </>
              ) : (
                <span className="text-xs text-muted-foreground">menggantikan {c.coach_name}, berlaku setelah cuti disetujui</span>
              )
            }
          />
        ))}
      </ul>
    </Card>
  );
}

function LeaveForm({ portal, onDone }: { portal: Portal; onDone: () => void }) {
  const [form, setForm] = useState({ leave_type: "annual", start_date: "", end_date: "", reason: "", exception: false });
  const end = form.end_date || form.start_date;
  const ready = Boolean(form.start_date) && end >= form.start_date;
  const impact = useQuery({
    queryKey: COACH_LEAVE_KEYS.impact(form.start_date, end, form.leave_type),
    queryFn: () => coachLeaveApi.impact(form.start_date, end, form.leave_type),
    enabled: ready,
  });
  const submit = useMutation({
    mutationFn: () =>
      coachLeaveApi.submitLeave({
        leave_type: form.leave_type,
        start_date: form.start_date,
        end_date: end,
        reason: form.reason.trim(),
        blackout_exception_requested: form.exception,
      }),
    onSuccess: () => {
      toast.success("Cuti diajukan", { description: "Minta pengganti untuk setiap sesi di bawah agar cuti bisa disetujui." });
      setForm({ leave_type: form.leave_type, start_date: "", end_date: "", reason: "", exception: false });
      onDone();
    },
    onError: (error) => toast.error("Pengajuan ditolak", { description: error.message }),
  });
  const rule = portal.notice_rules[form.leave_type];
  const i = impact.data;
  const blocked = i?.notice ? !i.notice.ok : false;
  const blackout = (i?.blackouts.length ?? 0) > 0;

  return (
    <Card className="space-y-3 p-5">
      <p className="text-sm font-semibold">Ajukan cuti</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Jenis" hint={rule ? `Minimal H-${rule.min_days}${rule.allow_short_notice ? ", boleh mendadak" : ""}` : undefined}>
          <select className={SELECT} value={form.leave_type} onChange={(e) => setForm({ ...form, leave_type: e.target.value })}>
            {LEAVE_TYPES.map((t) => (
              <option key={t} value={t}>
                {LEAVE_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Mulai">
          <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
        </Field>
        <Field label="Sampai" hint="Kosongkan untuk satu hari">
          <Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
        </Field>
      </div>
      <Field label="Alasan" hint="Minimal 10 karakter">
        <Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
      </Field>

      {ready && impact.isLoading && <p className="text-sm text-muted-foreground">Memeriksa jadwal…</p>}
      {impact.error && <p className="text-sm text-danger">{impact.error.message}</p>}
      {i && (
        <div className="space-y-2">
          {i.notice?.message && <p className="rounded-2xl bg-danger-soft px-4 py-2 text-sm text-danger">{i.notice.message}</p>}
          {i.notice?.ok && i.notice.short_notice && (
            <p className="rounded-2xl bg-warning-soft px-4 py-2 text-sm text-warning">
              Diajukan H-{i.notice.notice_days}, di bawah minimal H-{i.notice.min_days}: tercatat sebagai cuti mendadak.
            </p>
          )}
          {blackout && (
            <div className="space-y-2 rounded-2xl bg-warning-soft px-4 py-2 text-sm text-warning">
              <p>
                Tanggal blackout:{" "}
                {i.blackouts.map((b) => `${b.date_from === b.date_to ? b.date_from : `${b.date_from} s.d. ${b.date_to}`} (${b.reason})`).join("; ")}
              </p>
              <label className="flex items-center gap-2 text-foreground">
                <Checkbox checked={form.exception} onCheckedChange={(v) => setForm({ ...form, exception: v === true })} />
                Minta pengecualian ke Program Director
              </label>
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            {i.sessions.length === 0
              ? "Tidak ada kelas atau sesi PT di tanggal ini."
              : `${formatNumber(i.classes)} kelas dan ${formatNumber(i.pt)} sesi PT terdampak, ${formatNumber(i.members)} member terdaftar. Setelah diajukan, minta pengganti untuk tiap sesi.`}
          </p>
          {i.sessions.length > 0 && (
            <ul className="flex flex-col gap-1">
              {i.sessions.map((s) => (
                <li key={s.id} className="rounded-2xl bg-surface-2 px-3 py-1.5 text-sm">
                  {s.kind === "pt" ? "PT · " : ""}
                  {s.class_name} · {tanggal(s.starts_at, s.timezone)}, {rentangJam(s.starts_at, s.ends_at, s.timezone)} ·{" "}
                  {formatNumber(s.booked)} member
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <Button
        disabled={!ready || form.reason.trim().length < 10 || blocked || (blackout && !form.exception) || submit.isPending}
        onClick={() => submit.mutate()}
      >
        Ajukan cuti
      </Button>
    </Card>
  );
}

function MyLeaves({ portal, onDone }: { portal: Portal; onDone: () => void }) {
  const [picking, setPicking] = useState<Cover | null>(null);
  if (portal.leaves.length === 0) {
    return (
      <Card className="py-0">
        <TableNote>Belum ada cuti dalam 60 hari terakhir atau yang akan datang.</TableNote>
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      {portal.leaves.map((l) => {
        const badge = LEAVE_STATUS_BADGE[l.status] ?? { label: l.status, variant: "muted" as const };
        const pending = l.status === "pending";
        return (
          <Card key={l.id} className="space-y-3 p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold">
                  {LEAVE_TYPE_LABEL[l.leave_type] ?? l.leave_type} · {leaveRange(l)}
                </p>
                <p className="text-sm text-muted-foreground">{l.reason}</p>
                {l.rejection_reason && <p className="text-sm text-danger">Alasan ditolak: {l.rejection_reason}</p>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {l.is_short_notice && <Badge variant="destructive">Cuti mendadak</Badge>}
                <Badge variant={badge.variant}>{badge.label}</Badge>
              </div>
            </div>
            <CoverList
              covers={l.covers}
              actions={(c) =>
                pending && (c.status === "open" || c.status === "declined") ? (
                  <Button size="xs" variant="soft" onClick={() => setPicking(c)}>
                    Minta pengganti
                  </Button>
                ) : null
              }
            />
          </Card>
        );
      })}
      {picking && (
        <SubstituteDialog
          cover={picking}
          title="Minta pengganti"
          confirmLabel="Kirim permintaan"
          load={coachLeaveApi.myCandidates}
          pick={coachLeaveApi.requestSubstitute}
          onClose={() => setPicking(null)}
          onDone={onDone}
        />
      )}
    </div>
  );
}

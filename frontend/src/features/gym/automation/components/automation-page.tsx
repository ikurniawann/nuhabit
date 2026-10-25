"use client";

import { useState } from "react";
import Link from "next/link";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { toast } from "sonner";
import { TableNote } from "@/features/crm/engagement/components/shared";
import { useDebounced } from "@/features/gym/use-debounced";
import { useCan } from "@/components/iam/iam-access-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Switch } from "@/components/ui/switch";
import { formatDateTime } from "@/lib/format";
import {
  AUTOMATION_KEYS,
  automationApi,
  formatEvery,
  JOB_STATUS_LABELS,
  reminderLabel,
  type JobSetting,
  type JobStatus,
  type JobView,
  type MemberHit,
} from "../api";

const STATUS_VARIANT: Record<JobStatus, "muted" | "info" | "success" | "destructive"> = {
  never: "muted",
  running: "info",
  ok: "success",
  failed: "destructive",
};

/** Gym → Otomasi & Pengingat: job latar gym, sakelar, pengaturan, jalankan sekarang, log notifikasi member. */
export function AutomationPage() {
  const jobs = useQuery({ queryKey: AUTOMATION_KEYS.jobs, queryFn: automationApi.jobs, refetchInterval: 30_000 });

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Gym · Otomasi"
        title="Otomasi & Pengingat"
        description="Job yang berjalan di latar: pengingat kelas dan PT, tutup sesi, generate jadwal, kedaluwarsa kredit, pendapatan pass. Matikan job untuk menghentikan jadwalnya; Jalankan sekarang tetap bisa dipakai."
      />
      <Card className="divide-y divide-border py-0">
        {jobs.isLoading ? (
          <TableNote>Memuat job…</TableNote>
        ) : jobs.error ? (
          <TableNote tone="danger">{jobs.error.message}</TableNote>
        ) : (
          (jobs.data ?? []).map((job) => <JobRow key={job.name} job={job} />)
        )}
      </Card>
      <MemberNotificationLog />
    </div>
  );
}

function JobRow({ job }: { job: JobView }) {
  const queryClient = useQueryClient();
  const canUpdate = useCan("gym.automation", "update");
  const refresh = () => void queryClient.invalidateQueries({ queryKey: AUTOMATION_KEYS.jobs });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => automationApi.save(job.name, { enabled }),
    onSuccess: (_, enabled) => {
      toast.success(enabled ? "Job dinyalakan" : "Job dimatikan", { description: job.label });
      refresh();
    },
    onError: (error) => toast.error("Job gagal diubah", { description: error.message }),
  });
  const run = useMutation({
    mutationFn: () => automationApi.run(job.name),
    onSuccess: () => toast.success("Job selesai dijalankan", { description: job.label }),
    onError: (error) => toast.error("Job gagal dijalankan", { description: error.message }),
    onSettled: refresh,
  });

  return (
    <div className="flex flex-col gap-3 px-4 py-4 sm:px-5 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">{job.label}</p>
          <Badge variant={STATUS_VARIANT[job.status]}>{JOB_STATUS_LABELS[job.status]}</Badge>
          {!job.enabled && <Badge variant="outline">Mati</Badge>}
        </div>
        {job.description && <p className="text-sm text-muted-foreground">{job.description}</p>}
        <p className="text-xs text-muted-foreground">
          <span className="font-mono">{job.name}</span> · {formatEvery(job.everySeconds)}
          {job.lastStartedAt && ` · terakhir jalan ${formatDateTime(job.lastStartedAt)}`}
          {job.lastSucceededAt && ` · terakhir berhasil ${formatDateTime(job.lastSucceededAt)}`}
        </p>
        {job.status === "failed" && job.lastError && (
          <p className="rounded-xl bg-danger-soft px-3 py-2 font-mono text-xs break-words text-danger">{job.lastError}</p>
        )}
        {job.rules.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {job.rules.map((r) => `${r.label}: ${r.value} ${r.unit}`).join(" · ")} ·{" "}
            <Link href="/dashboard/gym/rules" className="font-medium text-forest underline-offset-4 hover:underline">
              Ubah di Aturan Gym
            </Link>
          </p>
        )}
        {job.settings.map((s) => (
          <JobSettingField key={s.key} job={job} setting={s} disabled={!canUpdate} onSaved={refresh} />
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={job.enabled}
            disabled={!canUpdate || toggle.isPending}
            onCheckedChange={(v) => toggle.mutate(v)}
            aria-label={`${job.enabled ? "Matikan" : "Nyalakan"} ${job.label}`}
          />
          {job.enabled ? "Aktif" : "Mati"}
        </label>
        {canUpdate && (
          <Button size="sm" variant="outline" disabled={run.isPending || job.status === "running"} onClick={() => run.mutate()}>
            <Play /> {run.isPending ? "Menjalankan…" : "Jalankan sekarang"}
          </Button>
        )}
      </div>
    </div>
  );
}

function JobSettingField({
  job,
  setting,
  disabled,
  onSaved,
}: {
  job: JobView;
  setting: JobSetting;
  disabled: boolean;
  onSaved: () => void;
}) {
  const [text, setText] = useState(String(setting.value));
  const value = Number(text);
  const valid = text.trim() !== "" && Number.isInteger(value) && value >= setting.min && value <= setting.max;
  const save = useMutation({
    mutationFn: () => automationApi.save(job.name, { settings: { [setting.key]: value } }),
    onSuccess: () => {
      toast.success("Pengaturan job disimpan", { description: `${setting.label}: ${value} ${setting.unit}` });
      onSaved();
    },
    onError: (error) => toast.error("Pengaturan gagal disimpan", { description: error.message }),
  });

  return (
    <form
      className="flex flex-wrap items-center gap-2 pt-1"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <label className="text-sm" htmlFor={`${job.name}-${setting.key}`}>
        {setting.label}
      </label>
      <Input
        id={`${job.name}-${setting.key}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        inputMode="numeric"
        className="w-24"
        disabled={disabled}
        aria-invalid={!valid}
      />
      <span className="text-sm text-muted-foreground">
        {setting.unit} ({setting.min} sampai {setting.max}, bawaan {setting.default})
      </span>
      {!disabled && (
        <Button type="submit" size="sm" variant="soft" disabled={!valid || value === setting.value || save.isPending}>
          Simpan
        </Button>
      )}
    </form>
  );
}

/** Pengingat dan notifikasi yang diterima satu member. */
function MemberNotificationLog() {
  const [term, setTerm] = useState("");
  const [member, setMember] = useState<MemberHit | null>(null);
  const q = useDebounced(term.trim());
  const hits = useQuery({
    queryKey: AUTOMATION_KEYS.members(q),
    queryFn: () => automationApi.members(q),
    enabled: q.length >= 2,
    placeholderData: keepPreviousData,
  });
  const log = useQuery({
    queryKey: AUTOMATION_KEYS.log(member?.id ?? ""),
    queryFn: () => automationApi.memberLog(member!.id),
    enabled: member !== null,
  });

  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-base font-semibold">Log notifikasi member</h2>
        <p className="text-sm text-muted-foreground">Cari member untuk melihat pengingat yang terkirim dan isi kotak notifikasinya.</p>
      </div>
      <Card className="space-y-4 p-4 sm:p-5">
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Nama atau nomor HP member"
          aria-label="Cari member"
          className="sm:max-w-sm"
        />
        {q.length >= 2 && (hits.data ?? []).length > 0 && !member && (
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {(hits.data ?? []).map((h) => (
              <li key={h.id}>
                <button type="button" className="w-full px-4 py-2.5 text-left hover:bg-surface" onClick={() => setMember(h)}>
                  <span className="block text-sm font-medium">{h.name ?? "Tanpa nama"}</span>
                  <span className="block text-xs text-muted-foreground">{h.phone ?? "-"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {q.length >= 2 && hits.data?.length === 0 && !member && (
          <p className="text-sm text-muted-foreground">Tidak ada member yang cocok.</p>
        )}
        {member && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">
                {member.name ?? "Tanpa nama"} <span className="text-sm text-muted-foreground">{member.phone}</span>
              </p>
              <Button size="sm" variant="ghost" onClick={() => setMember(null)}>
                Ganti member
              </Button>
            </div>
            {log.isLoading ? (
              <TableNote>Memuat log…</TableNote>
            ) : log.error ? (
              <TableNote tone="danger">{log.error.message}</TableNote>
            ) : log.data ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Pengingat terkirim</h3>
                  {log.data.reminders.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Belum ada pengingat.</p>
                  ) : (
                    <ul className="divide-y divide-border rounded-2xl border border-border">
                      {log.data.reminders.map((r) => (
                        <li key={`${r.kind}-${r.subjectId}-${r.period}`} className="flex items-center justify-between gap-3 px-4 py-2.5">
                          <span className="text-sm">{reminderLabel(r.kind)}</span>
                          <span className="text-xs text-muted-foreground">{formatDateTime(r.sentAt)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Kotak notifikasi</h3>
                  {log.data.notifications.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Belum ada notifikasi.</p>
                  ) : (
                    <ul className="divide-y divide-border rounded-2xl border border-border">
                      {log.data.notifications.map((n) => (
                        <li key={n.id} className="space-y-0.5 px-4 py-2.5">
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="text-sm font-medium">{n.title}</span>
                            <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(n.createdAt)}</span>
                          </div>
                          {n.body && <p className="text-xs text-muted-foreground">{n.body}</p>}
                          <p className="text-xs text-muted-foreground">{n.readAt ? `Dibaca ${formatDateTime(n.readAt)}` : "Belum dibaca"}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </Card>
    </section>
  );
}

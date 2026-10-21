"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { apiGet, apiPatch } from "@/lib/api-client";
import {
  type ApproverCandidate,
  type ApproverSource,
  type CoachLeaveSettings,
  MAX_NOTICE_DAYS,
  NOTICE_LEAVE_TYPES,
  type NoticeRules,
} from "@/lib/studio/coach-leave";
import { LEAVE_TYPE_LABELS } from "@/types/hris";
import { MAX_SUBSTITUTE_RESPONSE_HOURS } from "@/lib/studio/coach-cover";
import { CoachLeaveQueue } from "./coach-leave-queue";
import { EmptyState, Field, NativeSelect, Pill, StudioPageHeader } from "./ui-bits";

interface CoachLeaveData {
  settings: CoachLeaveSettings;
  program_directors: ApproverCandidate[];
  backup: ApproverCandidate | null;
  active_approvers: ApproverCandidate[];
  approver_source: ApproverSource;
  candidates: { id: string; name: string; role: string }[];
}

const SOURCE_LABEL: Record<ApproverSource, string> = {
  program_director: "Program Director",
  backup: "Approver cadangan (semua Program Director sedang cuti atau belum ada)",
  super_admin: "Hanya Super Admin (Program Director & approver cadangan tidak tersedia)",
};

export function StudioCoachLeavePage() {
  const [data, setData] = useState<CoachLeaveData | null>(null);
  const [backupId, setBackupId] = useState("");
  const [rules, setRules] = useState<NoticeRules | null>(null);
  const [responseHours, setResponseHours] = useState(24);
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    () =>
      apiGet<{ data: CoachLeaveData }>("/api/studio/coach-leave/settings")
        .then((res) => {
          setData(res.data);
          setBackupId(res.data.settings.backup_approver_user_id ?? "");
          setRules(res.data.settings.notice_rules);
          setResponseHours(res.data.settings.substitute_response_hours);
        })
        .catch((e) => toast.error(e instanceof Error ? e.message : "Gagal memuat pengaturan")),
    []
  );

  useEffect(() => {
    load();
  }, [load]);

  if (!data || !rules) {
    return (
      <div className="flex justify-center p-16 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  const directorIds = new Set(data.program_directors.map((p) => p.userId));
  const backupOptions = data.candidates.filter((c) => !directorIds.has(c.id));
  const dirty =
    backupId !== (data.settings.backup_approver_user_id ?? "") ||
    responseHours !== data.settings.substitute_response_hours ||
    JSON.stringify(rules) !== JSON.stringify(data.settings.notice_rules);
  const setRule = (type: keyof NoticeRules, patch: Partial<NoticeRules[keyof NoticeRules]>) =>
    setRules((r) => (r ? { ...r, [type]: { ...r[type], ...patch } } : r));

  async function save() {
    setSaving(true);
    try {
      const res = await apiPatch<{ message?: string }>("/api/studio/coach-leave/settings", {
        backup_approver_user_id: backupId || null,
        notice_rules: rules,
        substitute_response_hours: responseHours,
      });
      toast.success(res.message ?? "Tersimpan");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 sm:p-6">
      <StudioPageHeader
        title="Cuti & Pengganti Coach"
        subtitle="Program Director menyetujui cuti coach, menunjuk pengganti, dan membatalkan kelas. Atur approver cadangan dan minimal pemberitahuan cuti sesuai SOP coach."
      />
      <div className="grid max-w-3xl gap-4">
        <CoachLeaveQueue />

        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-nh-forest" />
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-foreground">Yang memutus cuti coach hari ini</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{SOURCE_LABEL[data.approver_source]}</p>
              {data.active_approvers.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {data.active_approvers.map((a) => (
                    <Pill key={a.userId} tone="brand">
                      {a.name}
                    </Pill>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <p className="mb-3 text-[13px] font-semibold text-foreground">Program Director</p>
          {data.program_directors.length === 0 ? (
            <EmptyState
              title="Belum ada Program Director"
              description="Beri role Program Director ke user di Manajemen User. Sampai ada, cuti coach diputus oleh approver cadangan."
              action={
                <Link href="/dashboard/settings/users" className="text-sm font-semibold text-nh-forest underline underline-offset-4">
                  Buka Manajemen User
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {data.program_directors.map((p) => (
                <li key={p.userId} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="truncate text-sm text-foreground">{p.name}</span>
                  <Pill tone={p.onLeave ? "warning" : "positive"}>{p.onLeave ? "Sedang cuti" : "Aktif"}</Pill>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="grid gap-4 rounded-xl border border-border bg-card p-5 shadow-sm">
          <Field
            label="Approver cadangan"
            hint="Memutus cuti coach hanya saat semua Program Director sedang cuti atau belum ada. Super Admin selalu bisa menggantikan."
          >
            <NativeSelect value={backupId} onChange={(e) => setBackupId(e.target.value)}>
              <option value="">— Tidak ada —</option>
              {backupOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {data.backup?.onLeave && (
            <p className="text-sm text-muted-foreground">{data.backup.name} sedang cuti hari ini.</p>
          )}
          <Field
            label="Batas jawaban calon pengganti (jam)"
            hint="Lewat batas ini permintaan kembali ke Butuh pengganti. Tidak pernah melewati 1 jam sebelum sesi mulai."
          >
            <Input
              type="number"
              min={1}
              max={MAX_SUBSTITUTE_RESPONSE_HOURS}
              className="max-w-32"
              value={responseHours}
              onChange={(e) => setResponseHours(Math.min(MAX_SUBSTITUTE_RESPONSE_HOURS, Math.max(1, Math.floor(Number(e.target.value) || 1))))}
            />
          </Field>
        </section>

        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <p className="text-[13px] font-semibold text-foreground">Minimal pemberitahuan cuti coach</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            H-N = tanggal mulai paling cepat N hari setelah tanggal pengajuan. Di bawah itu pengajuan ditolak, kecuali jenis yang
            boleh mendadak: tetap diterima tetapi ditandai <span className="font-semibold text-foreground">Mendadak</span>. Hanya
            berlaku untuk karyawan yang terhubung ke profil coach.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-semibold">Jenis cuti</th>
                  <th className="w-28 py-2 pr-3 font-semibold">Minimal H-</th>
                  <th className="w-32 py-2 font-semibold">Boleh mendadak</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {NOTICE_LEAVE_TYPES.map((type) => (
                  <tr key={type}>
                    <td className="py-2 pr-3 text-foreground">{LEAVE_TYPE_LABELS[type]}</td>
                    <td className="py-2 pr-3">
                      <Input
                        type="number"
                        min={0}
                        max={MAX_NOTICE_DAYS}
                        value={rules[type].min_days}
                        aria-label={`Minimal H- ${LEAVE_TYPE_LABELS[type]}`}
                        onChange={(e) =>
                          setRule(type, { min_days: Math.min(MAX_NOTICE_DAYS, Math.max(0, Math.floor(Number(e.target.value) || 0))) })
                        }
                      />
                    </td>
                    <td className="py-2">
                      <Switch
                        checked={rules[type].allow_short_notice}
                        onCheckedChange={(v) => setRule(type, { allow_short_notice: v })}
                        aria-label={`${LEAVE_TYPE_LABELS[type]} boleh mendadak`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div>
          <Button onClick={save} disabled={saving || !dirty}>
            {saving && <Loader2 className="size-4 animate-spin" />} Simpan pengaturan
          </Button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { apiGet, apiPatch } from "@/lib/api-client";
import type { ApproverCandidate, ApproverSource, CoachLeaveSettings } from "@/lib/studio/coach-leave";
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
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    () =>
      apiGet<{ data: CoachLeaveData }>("/api/studio/coach-leave/settings")
        .then((res) => {
          setData(res.data);
          setBackupId(res.data.settings.backup_approver_user_id ?? "");
        })
        .catch((e) => toast.error(e instanceof Error ? e.message : "Gagal memuat pengaturan")),
    []
  );

  useEffect(() => {
    load();
  }, [load]);

  if (!data) {
    return (
      <div className="flex justify-center p-16 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  const directorIds = new Set(data.program_directors.map((p) => p.userId));
  const backupOptions = data.candidates.filter((c) => !directorIds.has(c.id));
  const dirty = backupId !== (data.settings.backup_approver_user_id ?? "");

  async function save() {
    setSaving(true);
    try {
      const res = await apiPatch<{ message?: string }>("/api/studio/coach-leave/settings", {
        backup_approver_user_id: backupId || null,
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
        subtitle="Program Director menyetujui cuti coach, menunjuk pengganti, dan membatalkan kelas. Approver cadangan dipakai saat Program Director sedang cuti atau belum ada."
      />
      <div className="grid max-w-3xl gap-4">
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
          <div>
            <Button onClick={save} disabled={saving || !dirty}>
              {saving && <Loader2 className="size-4 animate-spin" />} Simpan
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}

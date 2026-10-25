"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Field, TableNote } from "@/features/crm/engagement/components/shared";
import { useIamAccess } from "@/components/iam/iam-access-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { formatNumber } from "@/lib/format";
import { SELECT } from "@/features/gym/shared";
import { useGymBranches } from "@/features/gym/branches";
import { COACH_LEAVE_KEYS, coachLeaveApi, LEAVE_TYPE_LABEL, leaveRange, type Cover, type QueueLeave } from "../api";
import { CoverList, SubstituteDialog } from "./cover-list";
import { BlackoutsPanel, SettingsPanel } from "./coach-leave-admin";
import { DisciplinePanel } from "./coach-discipline";
import { ChangeReport } from "./change-report";

const TABS = [
  { value: "queue", label: "Antrean cuti" },
  { value: "blackouts", label: "Tanggal blackout" },
  { value: "discipline", label: "Disiplin" },
  { value: "changes", label: "Laporan perubahan" },
  { value: "settings", label: "Pengaturan" },
] as const;
type TabValue = (typeof TABS)[number]["value"];

/** Gym → Cuti & Pengganti Coach: antrean Program Director, blackout, disiplin, laporan perubahan jadwal, pengaturan. */
export function CoachLeavePage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requested = searchParams.get("tab");
  const tab: TabValue = TABS.some((t) => t.value === requested) ? (requested as TabValue) : "queue";

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Gym & Kelas"
        title="Cuti & Pengganti Coach"
        description="Cuti coach baru bisa disetujui setelah semua kelas dan sesi PT di tanggal cuti punya pengganti atau dibatalkan."
      />
      <Tabs
        value={tab}
        onValueChange={(value) => {
          const next = new URLSearchParams(searchParams);
          if (value === "queue") next.delete("tab");
          else next.set("tab", String(value));
          const search = next.toString();
          router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
        }}
        className="w-full flex-col"
      >
        <TabsList variant="line">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="queue" className="mt-4">
          <Queue />
        </TabsContent>
        <TabsContent value="blackouts" className="mt-4">
          <BlackoutsPanel />
        </TabsContent>
        <TabsContent value="discipline" className="mt-4">
          <DisciplinePanel />
        </TabsContent>
        <TabsContent value="changes" className="mt-4">
          <ChangeReport />
        </TabsContent>
        <TabsContent value="settings" className="mt-4">
          <SettingsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Queue() {
  const [branchId, setBranchId] = useState("");
  const branches = useGymBranches();
  const queue = useQuery({
    queryKey: COACH_LEAVE_KEYS.queue(branchId),
    queryFn: () => coachLeaveApi.queue(branchId),
    refetchInterval: 60_000,
  });
  const list = queue.data ?? [];

  return (
    <div className="space-y-4">
      {(branches.data?.branches.length ?? 0) > 1 && (
        <select aria-label="Cabang" className={`${SELECT} sm:w-64`} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
          <option value="">Semua cabang</option>
          {branches.data?.branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      )}
      {queue.isLoading ? (
        <Card className="py-0">
          <TableNote>Memuat antrean…</TableNote>
        </Card>
      ) : queue.error ? (
        <Card className="py-0">
          <TableNote tone="danger">{queue.error.message}</TableNote>
        </Card>
      ) : list.length === 0 ? (
        <Card className="py-0">
          <TableNote>Tidak ada cuti coach yang menunggu keputusan.</TableNote>
        </Card>
      ) : (
        list.map((l) => <QueueCard key={l.id} leave={l} />)
      )}
    </div>
  );
}

const SOURCE_LABEL: Record<QueueLeave["approvers"]["source"], string> = {
  program_director: "Program Director",
  backup: "Approver cadangan",
  super_admin: "Super Admin (tidak ada Program Director atau cadangan yang tersedia)",
};

function QueueCard({ leave: l }: { leave: QueueLeave }) {
  const queryClient = useQueryClient();
  const { can } = useIamAccess();
  const manage = can("gym.coach-leave", "update") && l.can_decide;
  const [picking, setPicking] = useState<Cover | null>(null);
  const [cancelling, setCancelling] = useState<Cover | null>(null);
  const [deciding, setDeciding] = useState<"approve" | "reject" | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: COACH_LEAVE_KEYS.all });
  const approvers = (l.approvers.approvers ?? []).map((a) => a.name).join(", ");

  return (
    <Card className="space-y-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">{l.coach.name}</p>
          <p className="text-sm text-muted-foreground">
            {LEAVE_TYPE_LABEL[l.leave_type] ?? l.leave_type} · {leaveRange(l)} · {formatNumber(l.total_days)} hari
            {l.notice_days !== null && ` · diajukan H-${l.notice_days}`}
          </p>
          <p className="mt-1 text-sm whitespace-pre-line">{l.reason}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {l.is_short_notice && <Badge variant="destructive">Cuti mendadak</Badge>}
          {l.blackouts.length > 0 && <Badge variant="warning">Kena blackout</Badge>}
          {l.blackout_exception_requested && <Badge variant="info">Minta pengecualian</Badge>}
          {l.blockers > 0 ? (
            <Badge variant="warning">{formatNumber(l.blockers)} sesi belum ada pengganti</Badge>
          ) : (
            <Badge variant="success">Semua sesi tertangani</Badge>
          )}
        </div>
      </div>
      {l.blackouts.length > 0 && (
        <p className="rounded-2xl bg-warning-soft px-4 py-2 text-sm text-warning">
          Tanggal blackout: {l.blackouts.map((b) => `${b.date_from === b.date_to ? b.date_from : `${b.date_from} s.d. ${b.date_to}`} (${b.reason})`).join("; ")}
        </p>
      )}
      <CoverList
        covers={l.covers}
        actions={(c) =>
          manage && c.status !== "void" ? (
            <>
              <Button size="xs" variant="soft" onClick={() => setPicking(c)}>
                Tunjuk pengganti
              </Button>
              {c.status !== "cancelled" && (
                <Button size="xs" variant="ghost" onClick={() => setCancelling(c)}>
                  Batalkan sesi
                </Button>
              )}
            </>
          ) : null
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <p className="text-xs text-muted-foreground">
          Diputus oleh {SOURCE_LABEL[l.approvers.source]}
          {approvers && `: ${approvers}`}
          {!l.can_decide && l.cannot_decide_reason && ` · ${l.cannot_decide_reason}`}
        </p>
        {manage && (
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setDeciding("reject")}>
              Tolak
            </Button>
            <Button disabled={l.blockers > 0} onClick={() => setDeciding("approve")}>
              Setujui cuti
            </Button>
          </div>
        )}
      </div>
      {picking && (
        <SubstituteDialog
          cover={picking}
          title="Tunjuk pengganti"
          confirmLabel="Tunjuk"
          load={coachLeaveApi.candidates}
          pick={coachLeaveApi.assign}
          onClose={() => setPicking(null)}
          onDone={refresh}
        />
      )}
      {cancelling && <CancelSessionDialog cover={cancelling} onClose={() => setCancelling(null)} onDone={refresh} />}
      {deciding && <DecideDialog leave={l} action={deciding} onClose={() => setDeciding(null)} onDone={refresh} />}
    </Card>
  );
}

function CancelSessionDialog({ cover, onClose, onDone }: { cover: Cover; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const save = useMutation({
    mutationFn: () => coachLeaveApi.cancelSession(cover.id, reason.trim()),
    onSuccess: () => {
      toast.success("Sesi akan dibatalkan saat cuti disetujui");
      onDone();
      onClose();
    },
    onError: (error) => toast.error("Gagal", { description: error.message }),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogPanel size="sm">
        <DialogPanelHeader>
          <DialogPanelTitle>Batalkan sesi</DialogPanelTitle>
          <DialogPanelDescription>
            {cover.class_name}. Sesi dibatalkan saat cuti disetujui; member yang booking diberi tahu dan kreditnya kembali.
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody>
          <Field label="Alasan">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Tidak ada coach pengganti" />
          </Field>
        </DialogPanelBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Kembali
          </Button>
          <Button variant="destructive" disabled={reason.trim().length < 5 || save.isPending} onClick={() => save.mutate()}>
            Batalkan sesi
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}

function DecideDialog({
  leave: l,
  action,
  onClose,
  onDone,
}: {
  leave: QueueLeave;
  action: "approve" | "reject";
  onClose: () => void;
  onDone: () => void;
}) {
  const [text, setText] = useState("");
  const needsOverride = action === "approve" && l.blackouts.length > 0;
  const needsText = action === "reject" || needsOverride;
  const min = action === "reject" ? 3 : 10;
  const save = useMutation({
    mutationFn: () =>
      coachLeaveApi.decide(
        l.id,
        action,
        action === "reject" ? { rejection_reason: text.trim() } : { blackout_override_reason: text.trim() || undefined }
      ),
    onSuccess: () => {
      toast.success(action === "approve" ? "Cuti disetujui, jadwal pengganti berlaku" : "Cuti ditolak");
      onDone();
      onClose();
    },
    onError: (error) => toast.error("Gagal memutus cuti", { description: error.message }),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogPanel size="sm">
        <DialogPanelHeader>
          <DialogPanelTitle>{action === "approve" ? "Setujui cuti" : "Tolak cuti"}</DialogPanelTitle>
          <DialogPanelDescription>
            {l.coach.name} · {LEAVE_TYPE_LABEL[l.leave_type] ?? l.leave_type} · {leaveRange(l)}
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-3">
          {action === "approve" && (
            <p className="text-sm text-muted-foreground">
              Kelas berpindah ke pengganti, sesi yang dibatalkan ditutup dan member diberi tahu. Tanggal cuti menjadi time-off coach.
            </p>
          )}
          {needsText && (
            <Field label={action === "reject" ? "Alasan penolakan" : "Alasan pengecualian blackout (minimal 10 karakter)"}>
              <Textarea value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
          )}
        </DialogPanelBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Kembali
          </Button>
          <Button
            variant={action === "approve" ? "default" : "destructive"}
            disabled={(needsText && text.trim().length < min) || save.isPending}
            onClick={() => save.mutate()}
          >
            {action === "approve" ? "Setujui" : "Tolak"}
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}

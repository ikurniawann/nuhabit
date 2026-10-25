"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Lock, Plus } from "lucide-react";
import { toast } from "sonner";
import { useIamAccess } from "@/components/iam/iam-access-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { careApi, type MemberFlag, type MemberFlags } from "../api";
import { hiddenMedicalLabel, REVIEW_LABEL, SOURCE_LABEL } from "../display";
import { AddFlagDialog, ReviewFlagDialog, useRefreshCare } from "./flag-dialogs";
import { FlagBadge, useMemberFlags } from "./flag-badges";

/**
 * Siapa yang boleh menambah, meninjau, dan menghapus penanda dari layar ini:
 * staf dengan menu Member Perhatian Khusus, atau coach di Kelas Saya dan PT.
 * Server tetap memeriksa coach-nya dan hak atas penanda medis.
 */
function useFlagActions(coach: boolean) {
  const { can } = useIamAccess();
  return {
    add: coach || can("gym.member-flags", "create"),
    remove: coach || can("gym.member-flags", "delete"),
    review: coach || can("gym.member-flags", "update"),
  };
}

/** Penanda satu member dengan catatan, tinjauan dan aksinya (profil 360, roster coach). */
export function FlagList({ entry, coach = false }: { entry: MemberFlags | undefined; coach?: boolean }) {
  const refresh = useRefreshCare();
  const allowed = useFlagActions(coach);
  const [reviewing, setReviewing] = useState<MemberFlag | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => careApi.removeFlag(id),
    onSuccess: () => {
      toast.success("Penanda dihapus");
      refresh();
    },
    onError: (error) => toast.error("Penanda gagal dihapus", { description: error.message }),
  });
  if (!entry || (entry.flags.length === 0 && entry.hidden_medical === 0)) return null;

  return (
    <ul className="space-y-2">
      {entry.flags.map((f) => (
        <li key={f.id} className="rounded-2xl bg-surface-2 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex flex-wrap items-center gap-1.5">
              <FlagBadge flag={f} />
              {f.review_status && (
                <Badge variant={f.review_status === "pending" ? "warning" : "muted"}>{REVIEW_LABEL[f.review_status]}</Badge>
              )}
            </span>
            <span className="flex gap-1">
              {f.category === "medical" && allowed.review && (
                <Button size="sm" variant="ghost" onClick={() => setReviewing(f)}>
                  Tinjau
                </Button>
              )}
              {allowed.remove && (
                <Button size="sm" variant="ghost" className="text-danger" disabled={remove.isPending} onClick={() => remove.mutate(f.id)}>
                  Hapus
                </Button>
              )}
            </span>
          </div>
          {f.note && <p className="mt-1 text-sm whitespace-pre-line">{f.note}</p>}
          {f.review_note && <p className="mt-1 text-sm text-muted-foreground">Tinjauan: {f.review_note}</p>}
          <p className="mt-1 text-xs text-muted-foreground">
            {SOURCE_LABEL[f.source]}
            {f.created_by_name && f.source !== "parq" ? ` · ${f.created_by_name}` : ""} · {formatDate(f.created_at)}
            {f.expires_on && ` · sampai ${formatDate(f.expires_on)}`}
            {f.reviewed_by_name && ` · ditinjau ${f.reviewed_by_name}`}
          </p>
        </li>
      ))}
      {entry.hidden_medical > 0 && (
        <li className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
          <Lock className="size-3.5" aria-hidden />
          {hiddenMedicalLabel(entry.hidden_medical)}. Detailnya hanya untuk coach member ini dan manajer gym.
        </li>
      )}
      {reviewing && <ReviewFlagDialog flag={reviewing} onClose={() => setReviewing(null)} />}
    </ul>
  );
}

/** Kartu Perhatian khusus di profil 360 member. */
export function MemberFlagsPanel({ customerId }: { customerId: string }) {
  const entry = useMemberFlags([customerId]).get(customerId);
  const allowed = useFlagActions(false);
  const [adding, setAdding] = useState(false);
  const empty = !entry || (entry.flags.length === 0 && entry.hidden_medical === 0);
  return (
    <Card className="gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Perhatian khusus</h2>
        {allowed.add && (
          <Button size="sm" variant="soft" onClick={() => setAdding(true)}>
            <Plus /> Penanda
          </Button>
        )}
      </div>
      {empty ? <p className="text-sm text-muted-foreground">Tidak ada penanda aktif.</p> : <FlagList entry={entry} />}
      {adding && <AddFlagDialog customerId={customerId} onClose={() => setAdding(false)} />}
    </Card>
  );
}

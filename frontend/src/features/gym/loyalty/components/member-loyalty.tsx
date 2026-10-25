"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormModal } from "@/components/ui/form-modal";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Can } from "@/components/iam/can";
import { Field, TableNote } from "@/features/crm/engagement/components/shared";
import { SELECT } from "@/features/gym/shared";
import { formatDate, formatDateTime, formatNumber, formatRupiah } from "@/lib/format";
import { LOYALTY_KEYS, STATUS_HINTS, STATUS_LABELS, loyaltyApi, perkLines, type MemberStatus, type Standing } from "../api";

const STATUS_VARIANT: Record<MemberStatus, "success" | "warning" | "destructive"> = {
  active: "success",
  suspended: "warning",
  banned: "destructive",
};

export function StatusBadge({ status }: { status: MemberStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABELS[status]}</Badge>;
}

/** Tier membership, XP dan status member di profil 360. */
export function MemberLoyalty({ customerId, name }: { customerId: string; name: string | null }) {
  const data = useQuery({ queryKey: LOYALTY_KEYS.member(customerId), queryFn: () => loyaltyApi.member(customerId) });
  const [editing, setEditing] = useState(false);

  if (data.isLoading) return <Card><TableNote>Memuat tier member…</TableNote></Card>;
  if (data.error || !data.data) return <Card><TableNote tone="danger">{data.error?.message ?? "Gagal memuat tier"}</TableNote></Card>;
  const { membership: ms, xp, standing, status_history: history } = data.data;
  const tierPerks = ms.tier ? [...perkLines(ms.tier), ...ms.tier.perks] : [];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card className="space-y-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">Tier membership (belanja 12 bulan)</p>
            <p className="text-xl font-semibold">{ms.tier?.name ?? "Belum bertier"}</p>
            {ms.valid_until && <p className="text-xs text-muted-foreground">Bertahan sampai {formatDate(ms.valid_until)}</p>}
          </div>
          {ms.frozen && <Badge variant="warning">Perks dibekukan</Badge>}
        </div>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-muted-foreground">Total belanja</dt>
          <dd className="text-right font-medium tabular-nums">{formatRupiah(ms.spend.total_idr)}</dd>
          <dt className="text-muted-foreground">Paket gym</dt>
          <dd className="text-right tabular-nums">{formatRupiah(ms.spend.gym_idr)}</dd>
          <dt className="text-muted-foreground">POS & F&B</dt>
          <dd className="text-right tabular-nums">{formatRupiah(ms.spend.pos_idr)}</dd>
          <dt className="text-muted-foreground">Toko online</dt>
          <dd className="text-right tabular-nums">{formatRupiah(ms.spend.shop_idr)}</dd>
        </dl>
        <p className="text-xs text-muted-foreground">
          Periode {formatDate(ms.spend.from)} sampai {formatDate(ms.spend.to)}.
          {ms.next && ` ${formatRupiah(ms.next.spend_needed_idr)} lagi ke ${ms.next.tier.name}.`}
          {ms.keep && ` Butuh ${formatRupiah(ms.keep.spend_needed_idr)} lagi agar tier bertahan${ms.keep.by ? ` setelah ${formatDate(ms.keep.by)}` : ""}.`}
        </p>
        {tierPerks.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {tierPerks.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        {ms.history.length > 0 && (
          <div className="border-t border-border pt-3 text-xs text-muted-foreground">
            {ms.history.slice(0, 5).map((h) => (
              <p key={h.created_at + h.direction}>
                {formatDate(h.created_at)}: {h.direction === "up" ? "naik" : "turun"} {h.from_tier_name ?? "tanpa tier"} ke {h.to_tier_name ?? "tanpa tier"}
              </p>
            ))}
          </div>
        )}
      </Card>
      <Card className="space-y-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">Status member</p>
            <div className="mt-1">
              <StatusBadge status={standing.status} />
            </div>
            {standing.status === "suspended" && standing.suspended_until && (
              <p className="mt-1 text-xs text-muted-foreground">Sampai {formatDateTime(standing.suspended_until)}</p>
            )}
            {standing.status !== "active" && standing.reason && <p className="mt-1 text-sm">{standing.reason}</p>}
          </div>
          <Can menu="gym.loyalty" action="update" mode="disable">
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Ubah status</Button>
          </Can>
        </div>
        <p className="text-xs text-muted-foreground">{STATUS_HINTS[standing.status]}</p>
        {xp && (
          <div className="border-t border-border pt-3 text-sm">
            <p className="text-xs text-muted-foreground">Progres (XP seumur hidup)</p>
            <p className="font-medium">
              {formatNumber(xp.lifetime_xp)} XP · {xp.tier?.name ?? "Member"}
              {xp.tier && xp.tier.discount_percent > 0 && ` · diskon ${xp.tier.discount_percent}%`}
            </p>
            {xp.next_tier && (
              <p className="text-xs text-muted-foreground">
                {formatNumber(Math.max(xp.next_tier.min_lifetime_xp - xp.lifetime_xp, 0))} XP lagi ke {xp.next_tier.name}
              </p>
            )}
          </div>
        )}
        {history.length > 0 && (
          <div className="border-t border-border pt-3 text-xs text-muted-foreground">
            {history.map((h) => (
              <p key={h.created_at}>
                {formatDateTime(h.created_at)}: {STATUS_LABELS[h.from_status]} ke {STATUS_LABELS[h.to_status]}
                {h.changed_by_name && ` oleh ${h.changed_by_name}`}
                {h.reason && `, ${h.reason}`}
              </p>
            ))}
          </div>
        )}
      </Card>
      {editing && <StatusDialog customerId={customerId} name={name} current={standing} onClose={() => setEditing(false)} />}
    </div>
  );
}

/** A week from today (YYYY-MM-DD), the default end of a suspension. */
function defaultUntil(): string {
  const d = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

/** Ubah status member: aktif, ditangguhkan sampai tanggal, atau diblokir, dengan alasan. */
export function StatusDialog({
  customerId,
  name,
  current,
  onClose,
}: {
  customerId: string;
  name: string | null;
  current: Standing;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<MemberStatus>(current.status);
  const [reason, setReason] = useState(current.reason ?? "");
  const [until, setUntil] = useState(current.suspended_until?.slice(0, 10) ?? defaultUntil());
  const save = useMutation({
    mutationFn: () =>
      loyaltyApi.setStatus(customerId, {
        status,
        reason,
        // End of the chosen day in Jakarta.
        suspended_until: status === "suspended" ? `${until}T23:59:59+07:00` : null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["gym-loyalty"] });
      toast.success(`Status ${name ?? "member"} diubah ke ${STATUS_LABELS[status]}`);
      onClose();
    },
    onError: (error) => toast.error("Status gagal diubah", { description: error.message }),
  });

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Status ${name ?? "member"}`}
      description="Perubahan dicatat di riwayat dan log audit, dan member mendapat notifikasi."
      submitLabel="Simpan status"
      cancelLabel="Batal"
      loadingLabel="Menyimpan…"
      loading={save.isPending}
      submitDisabled={status !== "active" && !reason.trim()}
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Field label="Status" hint={STATUS_HINTS[status]}>
        <select className={SELECT} value={status} onChange={(e) => setStatus(e.target.value as MemberStatus)}>
          {(Object.keys(STATUS_LABELS) as MemberStatus[]).map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
      </Field>
      {status === "suspended" && (
        <Field label="Ditangguhkan sampai">
          <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </Field>
      )}
      {status !== "active" && (
        <Field label="Alasan">
          <Textarea rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      )}
    </FormModal>
  );
}

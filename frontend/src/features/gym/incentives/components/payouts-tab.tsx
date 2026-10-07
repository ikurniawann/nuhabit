"use client";

import { useState } from "react";
import { useMutation, type UseQueryResult } from "@tanstack/react-query";
import { Banknote } from "lucide-react";
import { toast } from "sonner";
import { Field, TableNote } from "@/features/crm/engagement/components/shared";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PAYOUT_STATUS_LABELS, type PayoutAction } from "@/lib/gym/incentive";
import { formatDateTime, formatNumber, formatRupiah } from "@/lib/format";
import { incentivesApi, type PayoutRow } from "../api";
import { usePayoutDetail, useRefreshMonth } from "../queries";
import { monthLabel, PAYOUT_VARIANT } from "./shared";
import { StatementDialog } from "./statements-tab";

/** Payout satu bulan: setujui, bayar dengan referensi, atau void dengan alasan. */
export function PayoutsTab({ month, query }: { month: string; query: UseQueryResult<PayoutRow[], Error> }) {
  const refresh = useRefreshMonth(month);
  const [acting, setActing] = useState<{ payout: PayoutRow; action: "pay" | "void" } | null>(null);
  const [viewing, setViewing] = useState<PayoutRow | null>(null);
  const approve = useMutation({
    mutationFn: (id: string) => incentivesApi.actOnPayout(id, "approve"),
    onSuccess: () => {
      toast.success("Payout disetujui");
      refresh();
    },
    onError: (error) => toast.error("Payout gagal disetujui", { description: error.message }),
  });
  const rows = query.data ?? [];

  return (
    <Card className="py-0">
      {query.isLoading ? (
        <TableNote>Memuat payout…</TableNote>
      ) : query.error ? (
        <TableNote tone="danger">{query.error.message}</TableNote>
      ) : rows.length === 0 ? (
        <TableNote>Belum ada payout untuk {monthLabel(month)}. Buat dari tab Statement.</TableNote>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Coach</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="hidden sm:table-cell">Status</TableHead>
              <TableHead className="hidden lg:table-cell">Referensi / catatan</TableHead>
              <TableHead className="text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => (
              <TableRow key={p.id} className={p.status === "void" ? "opacity-60" : undefined}>
                <TableCell>
                  <p className="font-medium">{p.coach_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatNumber(p.sessions)} kelas · dibuat {formatDateTime(p.created_at)}
                  </p>
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatRupiah(p.total_idr)}</TableCell>
                <TableCell className="hidden sm:table-cell">
                  <Badge variant={PAYOUT_VARIANT[p.status]}>{PAYOUT_STATUS_LABELS[p.status]}</Badge>
                </TableCell>
                <TableCell className="hidden max-w-[16rem] whitespace-normal text-xs lg:table-cell">
                  {p.payment_reference && <span className="font-mono">{p.payment_reference}</span>}
                  {p.note && <span className="block text-muted-foreground">{p.note}</span>}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setViewing(p)}>
                      Rincian
                    </Button>
                    {p.status === "draft" && (
                      <Button size="sm" variant="soft" disabled={approve.isPending} onClick={() => approve.mutate(p.id)}>
                        Setujui
                      </Button>
                    )}
                    {p.status === "approved" && (
                      <Button size="sm" onClick={() => setActing({ payout: p, action: "pay" })}>
                        <Banknote /> Bayar
                      </Button>
                    )}
                    {(p.status === "draft" || p.status === "approved") && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-danger"
                        onClick={() => setActing({ payout: p, action: "void" })}
                      >
                        Void
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {acting && (
        <PayoutActionDialog payout={acting.payout} action={acting.action} onClose={() => setActing(null)} onDone={refresh} />
      )}
      {viewing && <FrozenStatementDialog payout={viewing} onClose={() => setViewing(null)} />}
    </Card>
  );
}

function FrozenStatementDialog({ payout, onClose }: { payout: PayoutRow; onClose: () => void }) {
  const detail = usePayoutDetail(payout.id);
  if (!detail.data) return null;
  return <StatementDialog title={`Payout ${payout.coach_name}`} statement={detail.data.statement} onClose={onClose} />;
}

function PayoutActionDialog({
  payout,
  action,
  onClose,
  onDone,
}: {
  payout: PayoutRow;
  action: Extract<PayoutAction, "pay" | "void">;
  onClose: () => void;
  onDone: () => void;
}) {
  const [value, setValue] = useState("");
  const isPay = action === "pay";
  const submit = useMutation({
    mutationFn: () =>
      incentivesApi.actOnPayout(payout.id, action, isPay ? { payment_reference: value.trim() } : { note: value.trim() }),
    onSuccess: () => {
      toast.success(isPay ? "Payout ditandai dibayar" : "Payout dibatalkan");
      onDone();
      onClose();
    },
    onError: (error) => toast.error("Payout gagal diproses", { description: error.message }),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="sm">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate();
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>
              {isPay ? "Bayar" : "Void"} payout {payout.coach_name}
            </DialogPanelTitle>
            <DialogPanelDescription>
              {isPay
                ? `${formatRupiah(payout.total_idr)} untuk ${monthLabel(payout.month)}. Catat nomor transfer atau bukti bayar.`
                : "Payout yang di-void tidak bisa dipulihkan. Buat payout baru dari tab Statement bila perlu."}
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody>
            <Field label={isPay ? "Referensi pembayaran" : "Alasan"}>
              <Input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={isPay ? "TRF-BCA-0925-01" : "Absensi dikoreksi"}
                required
                autoFocus
              />
            </Field>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" variant={isPay ? "default" : "destructive"} disabled={!value.trim() || submit.isPending}>
              {isPay ? "Tandai dibayar" : "Void payout"}
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}

"use client";

import { useState } from "react";
import { useMutation, type UseQueryResult } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { TableNote } from "@/features/crm/engagement/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogPanel, DialogPanelBody, DialogPanelDescription, DialogPanelHeader, DialogPanelTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PAYOUT_STATUS_LABELS, type CoachStatement } from "@/lib/gym/incentive";
import type { CoachStatementView } from "@/lib/gym/incentive-server";
import { formatDateTime, formatNumber, formatRupiah } from "@/lib/format";
import { incentivesApi } from "../api";
import { useRefreshMonth } from "../queries";
import { monthLabel, PAYOUT_VARIANT } from "./shared";

/** Statement berjalan per coach; payout draf dibuat dari sini. */
export function StatementsTab({ month, query }: { month: string; query: UseQueryResult<CoachStatementView[], Error> }) {
  const refresh = useRefreshMonth(month);
  const [detail, setDetail] = useState<(CoachStatement & { coachName: string }) | null>(null);
  const create = useMutation({
    mutationFn: (coachId: string) => incentivesApi.createPayout(coachId, month),
    onSuccess: () => {
      toast.success("Payout draf dibuat", { description: "Statement bulan ini dibekukan. Setujui lalu bayar di tab Payout." });
      refresh();
    },
    onError: (error) => toast.error("Payout gagal dibuat", { description: error.message }),
  });
  const rows = query.data ?? [];

  return (
    <Card className="py-0">
      {query.isLoading ? (
        <TableNote>Menghitung statement…</TableNote>
      ) : query.error ? (
        <TableNote tone="danger">{query.error.message}</TableNote>
      ) : rows.length === 0 ? (
        <TableNote>Belum ada coach aktif.</TableNote>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Coach</TableHead>
              <TableHead className="text-right">Kelas</TableHead>
              <TableHead className="hidden text-right md:table-cell">Hadir</TableHead>
              <TableHead className="hidden text-right md:table-cell">No-show</TableHead>
              <TableHead className="hidden text-right lg:table-cell">Bonus</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Payout</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((s) => (
              <TableRow key={s.coachId}>
                <TableCell>
                  <p className="font-medium">{s.coachName}</p>
                  <p className="text-xs text-muted-foreground">{s.schemeName}</p>
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(s.totals.sessions)}</TableCell>
                <TableCell className="hidden text-right tabular-nums md:table-cell">{formatNumber(s.totals.attended)}</TableCell>
                <TableCell className="hidden text-right tabular-nums md:table-cell">
                  {s.totals.noShows > 0 ? <span className="text-warning">{formatNumber(s.totals.noShows)}</span> : 0}
                </TableCell>
                <TableCell className="hidden text-right tabular-nums lg:table-cell">{formatRupiah(s.totals.bonusIdr)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatRupiah(s.totals.totalIdr)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setDetail(s)} disabled={s.lines.length === 0}>
                      Rincian
                    </Button>
                    {s.payout ? (
                      <Badge variant={PAYOUT_VARIANT[s.payout.status]}>{PAYOUT_STATUS_LABELS[s.payout.status]}</Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="soft"
                        disabled={create.isPending || s.totals.sessions === 0}
                        onClick={() => create.mutate(s.coachId)}
                      >
                        <Plus /> Buat payout
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {detail && <StatementDialog title={`Rincian ${detail.coachName}`} statement={detail} onClose={() => setDetail(null)} />}
    </Card>
  );
}

/** Rincian per kelas sebuah statement (berjalan atau yang dibekukan di payout). */
export function StatementDialog({ title, statement, onClose }: { title: string; statement: CoachStatement; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="xl">
        <DialogPanelHeader>
          <DialogPanelTitle>{title}</DialogPanelTitle>
          <DialogPanelDescription>
            {monthLabel(statement.periodMonth)} · {formatNumber(statement.totals.sessions)} kelas · total{" "}
            {formatRupiah(statement.totals.totalIdr)}
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="px-0 py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kelas</TableHead>
                <TableHead className="text-right">Hadir</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Honor sesi</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Peserta</TableHead>
                <TableHead className="hidden text-right md:table-cell">Bonus</TableHead>
                <TableHead className="hidden text-right md:table-cell">Potongan</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {statement.lines.map((line) => (
                <TableRow key={line.sessionId}>
                  <TableCell>
                    <p className="font-medium">{line.classTypeName}</p>
                    <p className="text-xs text-muted-foreground">{formatDateTime(line.startsAt)}</p>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {line.attended}/{line.capacity}
                    {line.noShows > 0 && <span className="block text-xs text-warning">{line.noShows} no-show</span>}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{formatRupiah(line.sessionFeeIdr)}</TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{formatRupiah(line.attendeeIdr)}</TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">{formatRupiah(line.bonusIdr)}</TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">
                    {line.penaltyIdr > 0 ? `− ${formatRupiah(line.penaltyIdr)}` : "—"}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatRupiah(line.totalIdr)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DialogPanelBody>
      </DialogPanel>
    </Dialog>
  );
}

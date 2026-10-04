"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableNote } from "@/features/crm/engagement/components/shared";
import { formatDateTime, formatNumber, formatRupiah } from "@/lib/format";
import { walletApi } from "../api";

const RUNS_KEY = ["wallet", "sweep-runs"];

/** Riwayat sapuan dompet + tombol "Jalankan sekarang". */
export function SweepPanel() {
  const queryClient = useQueryClient();
  const runs = useQuery({ queryKey: RUNS_KEY, queryFn: walletApi.sweepRuns });
  const run = useMutation({
    mutationFn: walletApi.runSweep,
    onSuccess: (r) => {
      if (r.status === "busy") {
        toast.message("Sapuan lain sedang berjalan. Coba lagi sebentar.");
      } else {
        toast.success("Sapuan selesai", {
          description: `${formatNumber(r.expired_lots)} lot hangus (${formatRupiah(r.expired_idr)}), ${formatNumber(r.reminders_sent)} pengingat, ${formatNumber(r.nudges_sent)} dorongan saldo rendah.`,
        });
      }
      void queryClient.invalidateQueries({ queryKey: RUNS_KEY });
      void queryClient.invalidateQueries({ queryKey: ["wallet", "member"] });
    },
    onError: (error) => toast.error("Sapuan gagal", { description: error.message }),
  });

  return (
    <Card className="py-0">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
        <div>
          <h2 className="text-base font-semibold">Sapuan saldo</h2>
          <p className="text-sm text-muted-foreground">
            Berjalan otomatis tiap jam: menghanguskan saldo kedaluwarsa, mengirim pengingat, dan dorongan saldo rendah.
          </p>
        </div>
        <Button variant="soft" onClick={() => run.mutate()} disabled={run.isPending}>
          <Play /> Jalankan sekarang
        </Button>
      </div>
      {runs.isLoading ? (
        <TableNote>Memuat riwayat…</TableNote>
      ) : (runs.data ?? []).length === 0 ? (
        <TableNote>Belum ada sapuan.</TableNote>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Waktu</TableHead>
              <TableHead className="text-right">Saldo hangus</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Pengingat</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Saldo rendah</TableHead>
              <TableHead className="hidden md:table-cell">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.data?.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  {formatDateTime(r.started_at)}
                  <span className="block text-xs text-muted-foreground">{r.trigger === "manual" ? "Manual" : "Otomatis"}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatRupiah(r.expired_idr)}
                  <span className="block text-xs text-muted-foreground">{formatNumber(r.expired_lots)} lot</span>
                </TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">{formatNumber(r.reminders_sent)}</TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">{formatNumber(r.nudges_sent)}</TableCell>
                <TableCell className="hidden md:table-cell">
                  {r.error ? (
                    <Badge variant="destructive" title={r.error}>
                      Gagal
                    </Badge>
                  ) : r.finished_at ? (
                    <Badge variant="success">Selesai</Badge>
                  ) : (
                    <Badge variant="warning">Berjalan</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

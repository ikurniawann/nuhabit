"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, EyeOff, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Field, TableNote } from "@/features/crm/engagement/components/shared";
import { SELECT } from "@/features/gym/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDuration } from "@/lib/gym/hyrox";
import { HYROX_STATIONS, RESULT_DIVISION_LABELS, TOTAL_TOLERANCE_SEC, formatSplit } from "@/lib/gym/hyrox-results";
import { formatDateTime } from "@/lib/format";
import { trainingApi, type RaceEventRow, type RaceResultRow } from "../api";

const STATUS_FILTERS = { all: undefined, pending: false, verified: true } as const;
type StatusFilter = keyof typeof STATUS_FILTERS;

/** Hasil HYROX member: staf memeriksa split lalu memberi lencana terverifikasi. */
export function RaceResultsPanel({ races }: { races: RaceEventRow[] }) {
  const queryClient = useQueryClient();
  const [raceId, setRaceId] = useState("");
  const [status, setStatus] = useState<StatusFilter>("pending");
  const [open, setOpen] = useState<RaceResultRow | null>(null);
  const results = useQuery({
    queryKey: ["gym", "race-results", raceId, status],
    queryFn: () => trainingApi.results({ raceId: raceId || undefined, verified: STATUS_FILTERS[status] }),
  });

  const verify = useMutation({
    mutationFn: ({ id, verified }: { id: string; verified: boolean }) => trainingApi.verifyResult(id, verified),
    onSuccess: (data) => {
      toast.success(data.verified ? "Hasil diverifikasi" : "Verifikasi dibatalkan");
      void queryClient.invalidateQueries({ queryKey: ["gym", "race-results"] });
      void queryClient.invalidateQueries({ queryKey: ["gym", "race-leaderboard"] });
    },
    onError: (error) => toast.error("Verifikasi gagal", { description: error.message }),
  });

  const rows = results.data ?? [];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Race">
          <select className={SELECT} value={raceId} onChange={(e) => setRaceId(e.target.value)}>
            <option value="">Semua race dan simulasi</option>
            {races.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select className={SELECT} value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
            <option value="pending">Belum diverifikasi</option>
            <option value="verified">Terverifikasi</option>
            <option value="all">Semua</option>
          </select>
        </Field>
      </div>

      <Card className="py-0">
        {results.isLoading ? (
          <TableNote>Memuat hasil…</TableNote>
        ) : results.error ? (
          <TableNote tone="danger">{results.error.message}</TableNote>
        ) : rows.length === 0 ? (
          <TableNote>Tidak ada hasil untuk filter ini.</TableNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead className="hidden md:table-cell">Race</TableHead>
                <TableHead className="hidden sm:table-cell">Divisi</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="max-w-[14rem] whitespace-normal">
                    <p className="flex items-center gap-1.5 font-medium">
                      {r.name ?? "Member"}
                      {!r.show_on_leaderboard && (
                        <EyeOff className="size-3.5 text-muted-foreground" aria-label="Disembunyikan dari leaderboard" />
                      )}
                    </p>
                    <p className="font-mono text-xs text-muted-foreground">{r.phone}</p>
                    <p className="mt-1 text-xs text-muted-foreground md:hidden">{r.race_name ?? "Simulasi HYROX"}</p>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <p>{r.race_name ?? "Simulasi HYROX"}</p>
                    <p className="text-xs text-muted-foreground">{formatDateTime(r.raced_at)}</p>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {RESULT_DIVISION_LABELS[r.division]}
                    {r.age_group && <span className="block text-xs text-muted-foreground">{r.age_group}</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatDuration(r.total_sec)}
                    {r.total_mismatch && (
                      <span className="mt-0.5 flex items-center justify-end gap-1 text-xs text-warning">
                        <TriangleAlert className="size-3" aria-hidden /> beda dari split
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setOpen(r)}>
                        Split
                      </Button>
                      {r.verified ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={verify.isPending}
                          onClick={() => verify.mutate({ id: r.id, verified: false })}
                        >
                          Batalkan
                        </Button>
                      ) : (
                        <Button size="sm" disabled={verify.isPending} onClick={() => verify.mutate({ id: r.id, verified: true })}>
                          <BadgeCheck /> Verifikasi
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {open && <SplitsDialog result={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function SplitsDialog({ result: r, onClose }: { result: RaceResultRow; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="lg">
        <DialogPanelHeader>
          <DialogPanelTitle>
            {r.name ?? "Member"} · {r.race_name ?? "Simulasi HYROX"}
          </DialogPanelTitle>
          <DialogPanelDescription>
            {RESULT_DIVISION_LABELS[r.division]}
            {r.age_group ? ` · ${r.age_group}` : ""} · {formatDateTime(r.raced_at)}
            {r.verified && " · terverifikasi"}
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="px-0 py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead className="text-right">Lari 1 km</TableHead>
                <TableHead>Stasiun</TableHead>
                <TableHead className="text-right">Waktu</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {HYROX_STATIONS.map((s, i) => (
                <TableRow key={s.name}>
                  <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatSplit(r.run_sec[i] ?? null) || "—"}</TableCell>
                  <TableCell>
                    {s.name} <span className="text-xs text-muted-foreground">{s.volume}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatSplit(r.station_sec[i] ?? null) || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-5 py-4 text-sm sm:grid-cols-4">
            <SplitStat label="Roxzone" value={r.roxzone_sec} />
            <SplitStat label="Jumlah split" value={r.splits_total_sec} />
            <SplitStat label="Total resmi" value={r.official_total_sec} />
            <SplitStat label="Dipakai di peringkat" value={r.total_sec} />
          </dl>
          {r.total_mismatch && (
            <p className="px-5 pb-4">
              <Badge variant="warning">Total resmi beda lebih dari {TOTAL_TOLERANCE_SEC} detik dari jumlah split</Badge>
            </p>
          )}
        </DialogPanelBody>
      </DialogPanel>
    </Dialog>
  );
}

function SplitStat({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value === null ? "—" : formatDuration(value)}</dd>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Coins, QrCode, ShieldX } from "lucide-react";
import { toast } from "sonner";
import { TableNote } from "@/features/crm/engagement/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { GATE_DENIAL_LABEL } from "@/lib/gym/booking";
import { angka, GYM_KEYS, jam, schedulingApi, waktu, type AccessLogRow, type CheckInResult } from "../api";

const TOKEN_INPUT_ID = "gym-checkin-token";
const SOURCE_LABEL: Record<AccessLogRow["source"], string> = { gate: "Gate", pos: "Kasir", manual: "Front desk" };

/**
 * Gym → Check-in: pindai QR kartu member (scanner bertindak sebagai keyboard
 * + Enter) atau tempel tokennya. Keputusan gate tampil di kartu hasil dan log.
 */
export function CheckinPage() {
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [last, setLast] = useState<CheckInResult | null>(null);
  const log = useQuery({ queryKey: GYM_KEYS.checkin, queryFn: schedulingApi.checkinLog, refetchInterval: 10_000 });

  const scan = useMutation({
    mutationFn: (value: string) => schedulingApi.scan(value),
    onSuccess: (result) => {
      setLast(result);
      void queryClient.invalidateQueries({ queryKey: GYM_KEYS.checkin });
      void queryClient.invalidateQueries({ queryKey: GYM_KEYS.sessions });
    },
    onError: (error) => toast.error("QR gagal diperiksa", { description: error.message }),
    onSettled: () => {
      setToken("");
      document.getElementById(TOKEN_INPUT_ID)?.focus();
    },
  });
  const today = log.data?.today ?? { checked_in: 0, denied: 0, credits: 0 };
  const rows = log.data?.log ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Gym & Kelas"
        title="Check-in"
        description="Tidak ada open gym: member masuk hanya dengan booking kelas terkonfirmasi, mulai 45 menit sebelum kelas. Kredit dipotong saat scan diterima."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <form
            className="flex flex-col gap-3 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (token.trim().length >= 8) scan.mutate(token.trim());
            }}
          >
            <Input
              id={TOKEN_INPUT_ID}
              autoFocus
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Pindai QR atau tempel token bcdqr_…"
              aria-label="Token QR member"
              className="font-mono"
            />
            <Button type="submit" disabled={scan.isPending || token.trim().length < 8}>
              <QrCode /> Periksa
            </Button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">QR member hanya berlaku sebentar dan sekali pakai.</p>
        </Card>
        <ScanResult result={last} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <StatCard label="Check-in kelas hari ini" value={angka(today.checked_in)} icon={<QrCode />} tone="ink" />
        <StatCard label="Kredit terpotong hari ini" value={angka(today.credits)} icon={<Coins />} />
        <StatCard
          label="Scan ditolak hari ini"
          value={angka(today.denied)}
          hint="Tanpa booking, QR kedaluwarsa, saldo kurang"
          icon={<ShieldX />}
          tone={today.denied ? "warning" : "default"}
        />
      </div>

      <Card className="py-0">
        {log.isLoading ? (
          <TableNote>Memuat log…</TableNote>
        ) : log.error ? (
          <TableNote tone="danger">{log.error.message}</TableNote>
        ) : rows.length === 0 ? (
          <TableNote>Belum ada scan.</TableNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Waktu</TableHead>
                <TableHead>Member</TableHead>
                <TableHead>Hasil</TableHead>
                <TableHead className="hidden md:table-cell">Sumber</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-xs">{waktu(row.created_at)}</TableCell>
                  <TableCell>
                    <p className="font-medium">{row.member_name ?? "Tidak diketahui"}</p>
                    {row.class_type_name && row.starts_at && (
                      <p className="text-xs text-muted-foreground">
                        {row.class_type_name}, {jam(row.starts_at)}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {row.decision === "allowed" ? (
                      <Badge variant="success">
                        {row.entry_kind === "re_entry" ? "Masuk ulang" : `Check-in · ${-row.credit_delta} kredit`}
                      </Badge>
                    ) : (
                      <Badge variant="destructive">{row.reason ? GATE_DENIAL_LABEL[row.reason] : "Ditolak"}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {SOURCE_LABEL[row.source]}
                    {row.staff_name && <span className="block text-xs text-muted-foreground">{row.staff_name}</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function ScanResult({ result }: { result: CheckInResult | null }) {
  if (!result) {
    return (
      <Card variant="soft">
        <p className="text-sm text-muted-foreground">Hasil scan terakhir tampil di sini.</p>
      </Card>
    );
  }
  const allowed = result.decision === "allowed";
  return (
    <Card variant={allowed ? "ink" : "default"} role="status">
      <p className={allowed ? "text-sm text-on-ink-muted" : "text-sm text-muted-foreground"}>
        {result.memberName ?? "Member"}
      </p>
      <p className={allowed ? "text-2xl font-bold text-on-ink" : "text-2xl font-bold text-danger"}>
        {allowed ? "Masuk" : "Ditolak"}
      </p>
      <p className={allowed ? "text-sm text-on-ink" : "text-sm text-foreground"}>{result.message}</p>
    </Card>
  );
}

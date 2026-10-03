"use client";

import { useQuery } from "@tanstack/react-query";
import { QrCode, ShieldX, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { QR_PROBLEM_LABEL } from "@/lib/crm/engagement/rules";
import { angka, engagementApi, waktu } from "../api";
import { TableNote } from "./shared";

/** CRM → Engagement → Check-in Member: log setiap scan QR kartu member di kasir. */
export function CheckinsPage() {
  const log = useQuery({
    queryKey: ["crm-engagement", "checkins"],
    queryFn: engagementApi.checkins,
    refetchInterval: 30_000,
  });
  const today = log.data?.today ?? { accepted: 0, denied: 0, members: 0 };
  const rows = log.data?.checkins ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="CRM · Engagement"
        title="Check-in Member"
        description="Setiap scan QR kartu member di kasir, termasuk yang ditolak. Diperbarui tiap 30 detik."
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <StatCard label="Scan diterima hari ini" value={angka(today.accepted)} icon={<QrCode />} tone="ink" />
        <StatCard label="Member unik hari ini" value={angka(today.members)} icon={<Users />} />
        <StatCard
          label="Scan ditolak hari ini"
          value={angka(today.denied)}
          hint="QR kedaluwarsa, dipakai ulang, atau tidak dikenal"
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
          <TableNote>Belum ada scan. Kasir memindai QR dari kartu member di portal /member.</TableNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Waktu</TableHead>
                <TableHead>Member</TableHead>
                <TableHead>Hasil</TableHead>
                <TableHead className="hidden md:table-cell">Kasir</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-xs">{waktu(row.created_at)}</TableCell>
                  <TableCell>
                    <p className="font-medium">{row.member_name ?? "Tidak diketahui"}</p>
                    {row.member_phone && <p className="font-mono text-xs text-muted-foreground">{row.member_phone}</p>}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {row.decision === "accepted" ? (
                      <Badge variant="success">Diterima</Badge>
                    ) : (
                      <Badge variant="destructive">{row.reason ? QR_PROBLEM_LABEL[row.reason] : "Ditolak"}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{row.cashier_name ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

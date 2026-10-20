"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { TableNote } from "@/features/crm/engagement/components/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMetric, METRICS } from "@/lib/gym/assessments";
import { formatDate } from "@/lib/format";
import { memberHref } from "@/features/gym/members/member-link";
import { useDebounced } from "@/features/gym/use-debounced";
import { COACHING_KEYS, coachingApi } from "../api";
import { AssessmentDialog } from "./assessment-dialog";

/** Metrik yang muat di tabel ringkas; riwayat lengkap ada di profil member. */
const SUMMARY = METRICS.filter((m) => ["weight_kg", "body_fat_pct", "run_1km_sec", "wall_balls_max_reps"].includes(m.key));

/** Gym → Asesmen Kebugaran: asesmen terbaru semua member dan pencatatan asesmen baru. */
export function AssessmentsPage() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const term = useDebounced(q.trim());
  const [creating, setCreating] = useState(false);
  const list = useQuery({
    queryKey: [...COACHING_KEYS.assessments, "recent", term],
    queryFn: () => coachingApi.assessments({ q: term }),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Gym & Kelas"
        title="Asesmen Kebugaran"
        description="Metrik tubuh dan benchmark HYROX per member. Riwayat dan grafik progres ada di profil member dan aplikasi member."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> Catat asesmen
          </Button>
        }
      />
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama atau HP member" aria-label="Cari member" />
      </div>
      <Card className="py-0">
        {list.isLoading ? (
          <TableNote>Memuat asesmen…</TableNote>
        ) : list.error ? (
          <TableNote tone="danger">{list.error.message}</TableNote>
        ) : (list.data ?? []).length === 0 ? (
          <TableNote>{term ? "Tidak ada asesmen untuk pencarian ini." : "Belum ada asesmen."}</TableNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Tanggal</TableHead>
                <TableHead>Coach</TableHead>
                {SUMMARY.map((m) => (
                  <TableHead key={m.key} className="text-right whitespace-nowrap">
                    {m.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(list.data ?? []).map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <Link href={`${memberHref(a.customer_id)}?tab=asesmen`} className="font-medium text-forest hover:underline">
                      {a.member_name ?? "Member"}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(a.assessed_on)}</TableCell>
                  <TableCell>{a.coach_name ?? "-"}</TableCell>
                  {SUMMARY.map((m) => (
                    <TableCell key={m.key} className="text-right tabular-nums">
                      {formatMetric(m, a[m.key])}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      {creating && (
        <AssessmentDialog
          onClose={() => setCreating(false)}
          onSaved={() => void queryClient.invalidateQueries({ queryKey: COACHING_KEYS.assessments })}
        />
      )}
    </div>
  );
}

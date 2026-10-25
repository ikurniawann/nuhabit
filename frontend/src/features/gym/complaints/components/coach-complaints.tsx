"use client";

import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { TableNote } from "@/features/crm/engagement/components/shared";
import { waktu } from "@/features/gym/scheduling/api";
import { formatDate } from "@/lib/format";
import { COMPLAINT_KEYS, complaintsApi } from "../api";
import { PriorityBadge, StatusBadge } from "./ticket-bits";

/** Kelas Saya → Keluhan: tiket 90 hari terakhir yang tertaut ke coach ini, hanya baca. */
export function CoachComplaints() {
  const mine = useQuery({ queryKey: COMPLAINT_KEYS.mine, queryFn: complaintsApi.mine });
  if (mine.isLoading) return <TableNote>Memuat keluhan…</TableNote>;
  if (mine.error) return <TableNote tone="danger">{mine.error.message}</TableNote>;
  const tickets = mine.data?.tickets ?? [];
  return (
    <Card className="divide-y divide-border py-0">
      {tickets.length === 0 ? (
        <TableNote>Tidak ada keluhan yang tertaut ke kamu dalam 90 hari terakhir.</TableNote>
      ) : (
        tickets.map((t) => (
          <div key={t.id} className="space-y-1 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">
                {t.code} · {t.title}
              </span>
              <PriorityBadge priority={t.priority} />
              <StatusBadge status={t.status} />
            </div>
            <p className="text-xs text-muted-foreground">
              {t.category_label} · masuk {formatDate(t.created_at)}
              {t.session_name && t.session_starts_at && ` · ${t.session_name}, ${waktu(t.session_starts_at, t.timezone)}`}
            </p>
            {t.description && <p className="text-sm whitespace-pre-wrap text-body">{t.description}</p>}
          </div>
        ))
      )}
    </Card>
  );
}

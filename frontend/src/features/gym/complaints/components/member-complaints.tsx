"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Can } from "@/components/iam/can";
import { useCan } from "@/components/iam/iam-access-provider";
import { TableNote } from "@/features/crm/engagement/components/shared";
import { formatDate } from "@/lib/format";
import { COMPLAINT_KEYS, EMPTY_FILTERS, complaintsApi, listQuery, ticketHref } from "../api";
import { NewTicketDialog } from "./new-ticket-dialog";
import { PriorityBadge, StatusBadge } from "./ticket-bits";

/** Tab Keluhan di profil 360 member: tiket member ini dan "Buat tiket" dari front desk. */
export function MemberComplaints({ customerId, name }: { customerId: string; name: string | null }) {
  const canRead = useCan("gym.complaints", "read");
  const [creating, setCreating] = useState(false);
  const query = listQuery({ ...EMPTY_FILTERS, status: "", customer_id: customerId }, 0, 50);
  const list = useQuery({ queryKey: COMPLAINT_KEYS.list(query), queryFn: () => complaintsApi.list(query), enabled: canRead });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Can menu="gym.complaints" action="create" mode="disable">
          <Button onClick={() => setCreating(true)}>
            <Plus /> Buat tiket
          </Button>
        </Can>
      </div>
      <Card className="divide-y divide-border py-0">
        {!canRead ? (
          <TableNote>Butuh izin melihat menu Keluhan.</TableNote>
        ) : list.isLoading ? (
          <TableNote>Memuat tiket…</TableNote>
        ) : list.error ? (
          <TableNote tone="danger">{list.error.message}</TableNote>
        ) : !list.data?.rows.length ? (
          <TableNote>Member ini belum punya tiket keluhan.</TableNote>
        ) : (
          list.data.rows.map((t) => (
            <Link key={t.id} href={ticketHref(t.id)} className="flex items-center gap-3 px-5 py-3 hover:bg-surface">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {t.code} · {t.title}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {t.category_label} · {formatDate(t.created_at)}
                  {t.coach_name && ` · ${t.coach_name}`}
                </span>
              </span>
              <PriorityBadge priority={t.priority} />
              <StatusBadge status={t.status} />
            </Link>
          ))
        )}
      </Card>
      {creating && <NewTicketDialog member={{ id: customerId, name }} onClose={() => setCreating(false)} />}
    </div>
  );
}

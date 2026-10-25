"use client";

import { useQuery } from "@tanstack/react-query";
import { Paperclip } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { TableNote } from "@/features/crm/engagement/components/shared";
import { formatDateLong } from "@/lib/format";
import { INVESTOR_KEYS, investorApi, type Attachment } from "../api";
import { fileSize } from "../format";
import { QueryState } from "./shared";

/** Daftar lampiran satu update, tautan unduh lewat /api/files. */
export function AttachmentList({ items }: { items: Attachment[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-wrap gap-2" aria-label="Lampiran">
      {items.map((a) => (
        <li key={a.id}>
          <a
            href={a.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-forest hover:bg-surface"
          >
            <Paperclip className="size-3.5" aria-hidden />
            {a.name}
            <span className="text-muted-foreground">({fileSize(a.size_bytes)})</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Investor → Progres: update yang diterbitkan direksi, terbaru di atas. */
export function InvestorProgressPage() {
  const updates = useQuery({ queryKey: INVESTOR_KEYS.updates, queryFn: investorApi.updates });
  return (
    <div className="space-y-4">
      <PageHeader kicker="Investor" title="Progres" description="Catatan kemajuan dan tonggak dari direksi untuk investor." />
      <QueryState loading={updates.isPending} error={updates.error} />
      {updates.data?.length === 0 && (
        <Card className="py-0">
          <TableNote>Belum ada update yang diterbitkan.</TableNote>
        </Card>
      )}
      <ol className="space-y-3" aria-label="Update untuk investor">
        {(updates.data ?? []).map((u) => (
          <li key={u.id}>
            <Card className="p-5">
              <article>
                <p className="text-xs text-muted-foreground">{u.published_at ? formatDateLong(u.published_at) : "-"}</p>
                <h2 className="mt-1 text-base font-semibold">{u.title}</h2>
                <p className="mt-2 whitespace-pre-wrap text-sm text-body">{u.body}</p>
                <AttachmentList items={u.attachments} />
              </article>
            </Card>
          </li>
        ))}
      </ol>
    </div>
  );
}

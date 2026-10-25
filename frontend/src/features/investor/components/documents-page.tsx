"use client";

import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableNote } from "@/features/crm/engagement/components/shared";
import { formatDate } from "@/lib/format";
import { INVESTOR_KEYS, investorApi } from "../api";
import { fileSize } from "../format";
import { QueryState } from "./shared";

/** Investor → Dokumen: lampiran dari update yang diterbitkan, terbaru di atas. */
export function InvestorDocumentsPage() {
  const docs = useQuery({ queryKey: INVESTOR_KEYS.documents, queryFn: investorApi.documents });
  const rows = docs.data ?? [];
  return (
    <div className="space-y-4">
      <PageHeader kicker="Investor" title="Dokumen" description="Berkas yang dilampirkan direksi pada update untuk investor." />
      <Card className="py-0">
        <QueryState loading={docs.isPending} error={docs.error} />
        {docs.data && rows.length === 0 && <TableNote>Belum ada dokumen.</TableNote>}
        {rows.length > 0 && (
          <Table aria-label="Dokumen investor">
            <TableHeader>
              <TableRow>
                <TableHead>Berkas</TableHead>
                <TableHead>Update</TableHead>
                <TableHead>Terbit</TableHead>
                <TableHead className="text-right">Ukuran</TableHead>
                <TableHead className="sr-only">Unduh</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.name}</TableCell>
                  <TableCell>{d.update_title}</TableCell>
                  <TableCell>{formatDate(d.published_at)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fileSize(d.size_bytes)}</TableCell>
                  <TableCell className="text-right">
                    <a
                      href={d.url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Unduh ${d.name}`}
                      className="inline-flex items-center gap-1 text-sm font-medium text-forest hover:underline"
                    >
                      <Download className="size-4" aria-hidden />
                      Unduh
                    </a>
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

"use client";

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Field, TableNote } from "@/features/crm/engagement/components/shared";
import { ACCESS_SOURCE_LABEL, entryLabel, GYM_KEYS, waktu, type AccessLogRow } from "@/features/gym/scheduling/api";
import { call, SELECT } from "@/features/gym/shared";
import { GATE_DENIAL_LABEL } from "@/lib/gym/booking";
import { formatNumber, formatTime } from "@/lib/format";
import { wibToday } from "@/features/gym/reports/params";
import { pageCount } from "../list-params";
import { MemberLink } from "../member-link";

interface LogRow extends AccessLogRow {
  customer_id: string | null;
}

const PAGE_SIZE = 50;

/** Log scan gate per rentang tanggal (WIB), dengan halaman dan unduhan CSV. */
export function CheckinLog() {
  const today = wibToday();
  const [range, setRange] = useState({ from: today, to: today });
  const [decision, setDecision] = useState<"" | "allowed" | "denied">("");
  const [page, setPage] = useState(1);
  const filter = new URLSearchParams({ from: range.from, to: range.to });
  if (decision) filter.set("decision", decision);
  const query = `${filter}&page=${page}&page_size=${PAGE_SIZE}`;
  const log = useQuery({
    queryKey: [...GYM_KEYS.checkin, "log", query],
    queryFn: () => call<{ rows: LogRow[]; total: number }>(`/api/gym/checkin/log?${query}`),
    placeholderData: keepPreviousData,
    refetchInterval: range.to >= today ? 10_000 : false,
  });
  const rows = log.data?.rows ?? [];
  const total = log.data?.total ?? 0;
  const pages = pageCount(total, PAGE_SIZE);
  const setDay = (key: "from" | "to") => (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.value) return;
    setRange({ ...range, [key]: e.target.value });
    setPage(1);
  };

  return (
    <Card className="py-0">
      <div className="flex flex-wrap items-end gap-3 px-5 pt-4">
        <h2 className="mr-auto self-center text-sm font-semibold">Log scan</h2>
        <Field label="Dari">
          <Input type="date" value={range.from} max={range.to} onChange={setDay("from")} />
        </Field>
        <Field label="Sampai">
          <Input type="date" value={range.to} min={range.from} max={today} onChange={setDay("to")} />
        </Field>
        <Field label="Hasil">
          <select
            className={SELECT}
            value={decision}
            onChange={(e) => {
              setDecision(e.target.value as typeof decision);
              setPage(1);
            }}
          >
            <option value="">Semua</option>
            <option value="allowed">Diterima</option>
            <option value="denied">Ditolak</option>
          </select>
        </Field>
        {total > 0 ? (
          <a href={`/api/gym/checkin/log?${filter}&format=csv`} download className={buttonVariants({ variant: "outline" })}>
            <Download /> CSV
          </a>
        ) : (
          <Button variant="outline" disabled>
            <Download /> CSV
          </Button>
        )}
      </div>
      {log.isLoading ? (
        <TableNote>Memuat log…</TableNote>
      ) : log.error ? (
        <TableNote tone="danger">{log.error.message}</TableNote>
      ) : rows.length === 0 ? (
        <TableNote>Belum ada scan di rentang ini.</TableNote>
      ) : (
        <Table aria-label="Log scan gate">
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
                  {row.customer_id ? (
                    <MemberLink id={row.customer_id} name={row.member_name} />
                  ) : (
                    <p className="font-medium">Tidak diketahui</p>
                  )}
                  {row.class_type_name && row.starts_at && (
                    <p className="text-xs text-muted-foreground">
                      {row.class_type_name}, {formatTime(row.starts_at)}
                    </p>
                  )}
                </TableCell>
                <TableCell className="whitespace-normal">
                  {row.decision === "allowed" ? (
                    <Badge variant="success">
                      {entryLabel(row.entry_kind, row.credit_delta)}
                    </Badge>
                  ) : (
                    <Badge variant="destructive">{row.reason ? GATE_DENIAL_LABEL[row.reason] : "Ditolak"}</Badge>
                  )}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {ACCESS_SOURCE_LABEL[row.source]}
                  {row.staff_name && <span className="block text-xs text-muted-foreground">{row.staff_name}</span>}
                  {row.device_name && <span className="block text-xs text-muted-foreground">{row.device_name}</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {total > PAGE_SIZE && (
        <nav aria-label="Halaman log scan" className="flex flex-wrap items-center justify-between gap-3 px-5 pb-4 text-sm">
          <p className="text-muted-foreground">
            {formatNumber(total)} scan · halaman {formatNumber(page)} dari {formatNumber(pages)}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              <ChevronLeft /> Sebelumnya
            </Button>
            <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              Berikutnya <ChevronRight />
            </Button>
          </div>
        </nav>
      )}
    </Card>
  );
}

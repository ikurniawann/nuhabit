"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableNote } from "@/features/crm/engagement/components/shared";
import { downloadCSV } from "@/lib/utils/csv-export";
import { cn } from "@/lib/utils";
import { csvFilename, tableCsv, type ReportColumn } from "../csv";

/** Tabel laporan dengan judul dan tombol unduh CSV untuk baris yang sama. */
export function ReportTable<T>({
  title,
  description,
  rows,
  columns,
  rowKey,
  csvName,
  period,
  filename = csvFilename(csvName, period.from, period.to),
  empty = "Tidak ada data di rentang ini.",
}: {
  title: string;
  description?: string;
  rows: T[];
  columns: ReportColumn<T>[];
  rowKey: (row: T, index: number) => string;
  csvName: string;
  period: { from: string; to: string };
  /** Nama berkas CSV; default laporan-gym-<csvName>-<dari>-<sampai>.csv. */
  filename?: string;
  empty?: string;
}) {
  return (
    <Card className="py-0">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={rows.length === 0}
          onClick={() => downloadCSV(tableCsv(rows, columns), filename)}
        >
          <Download /> CSV<span className="sr-only"> {title}</span>
        </Button>
      </div>
      {rows.length === 0 ? (
        <TableNote>{empty}</TableNote>
      ) : (
        <Table aria-label={title}>
          <TableHeader>
            <TableRow>
              {columns.map((c) => (
                <TableHead key={c.label} className={cn(c.numeric && "text-right")}>
                  {c.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, i) => (
              <TableRow key={rowKey(row, i)}>
                {columns.map((c) => (
                  <TableCell key={c.label} className={cn(c.numeric && "text-right tabular-nums")}>
                    {c.render ? c.render(row) : c.value(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

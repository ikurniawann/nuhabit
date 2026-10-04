"use client";

import type { ReactNode } from "react";
import { ArrowPathIcon, DocumentArrowDownIcon } from "@heroicons/react/24/outline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { breakdownBars, type BreakdownInput } from "@/lib/purchasing/report-ui-shared";

/** Judul laporan + tombol muat ulang; tombol ekspor lewat `children`. */
export function ReportHeader({
  title,
  description,
  loading,
  onRefresh,
  refreshLabel = "Refresh",
  children,
}: {
  title: string;
  description: string;
  loading: boolean;
  onRefresh: () => void;
  refreshLabel?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
          <ArrowPathIcon className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {refreshLabel}
        </Button>
        {children}
      </div>
    </div>
  );
}

export function ExportButton({
  label,
  busyLabel = "Exporting...",
  busy = false,
  disabled,
  onClick,
}: {
  label: string;
  busyLabel?: string;
  busy?: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={disabled}>
      <DocumentArrowDownIcon className="mr-1 h-4 w-4" />
      {busy ? busyLabel : label}
    </Button>
  );
}

export function ReportFilterField({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

export function DateFilterField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <ReportFilterField label={label}>
      <Input type="date" value={value} onChange={(event) => onChange(event.target.value)} className="h-10" />
    </ReportFilterField>
  );
}

export function ReportStatCard({
  title,
  value,
  hint,
  valueClassName = "text-foreground",
}: {
  title: string;
  value: ReactNode;
  hint?: ReactNode;
  valueClassName?: string;
}) {
  return (
    <Card className="border-border shadow-xs">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className={`text-2xl font-bold ${valueClassName}`}>{value}</p>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

/** Daftar bar horizontal: label + keterangan, nilai, pangsa (%) dari total. */
export function ReportBreakdownCard({
  title,
  loading,
  rows,
  total,
  formatValue,
}: {
  title: string;
  loading: boolean;
  rows: BreakdownInput[];
  total: number;
  formatValue: (value: number) => string;
}) {
  return (
    <Card className="border-border shadow-xs">
      <CardHeader className="border-b border-gray-200/70 pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Memuat...</p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Tidak ada data</p>
        ) : (
          breakdownBars(rows, total).map((row) => (
            <div key={row.key} className="space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-foreground">{row.label}</p>
                  <p className="text-xs text-muted-foreground">{row.caption}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-foreground">{formatValue(row.value)}</p>
                  <p className="text-xs text-muted-foreground">{row.share.toFixed(1)}%</p>
                </div>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-2 rounded-full bg-primary/70 transition-all" style={{ width: `${row.width}%` }} />
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

/** Kartu tabel laporan: judul + jumlah baris di header, catatan di footer. */
export function ReportTableCard({
  title,
  count,
  actions,
  footer,
  children,
}: {
  title: string;
  count: number;
  actions?: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="border-border shadow-xs">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b border-gray-200/70 pb-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">{title}</CardTitle>
          <Badge variant="secondary" className="border-border bg-muted/50 text-muted-foreground">
            {count} baris
          </Badge>
        </div>
        {actions}
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto px-4">{children}</div>
        <div className="border-t border-gray-200/70 px-4 py-3 text-xs text-muted-foreground">{footer}</div>
      </CardContent>
    </Card>
  );
}

/** Baris tabel penuh untuk status memuat / kosong. */
export function ReportTableMessage({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-12 text-center text-muted-foreground">
        {children}
      </td>
    </tr>
  );
}

"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import type { AuditLogFilters, AuditRow } from "../api";
import { useAuditLog } from "../queries";
import { AuditDetailDialog } from "./audit-detail-dialog";
import { ACTION_LABELS, DESTRUCTIVE_ACTIONS, ENTITY_LABELS } from "./audit-labels";

const ALL = "all";

const INITIAL_FILTERS: AuditLogFilters = {
  page: 1,
  actorId: "",
  entity: null,
  action: null,
  search: "",
  dateFrom: "",
  dateTo: "",
};

/** Settings → Audit Trail: jejak append-only aksi stok, pembelian, dan hutang. */
export function AuditTrailPage() {
  const [filters, setFilters] = useState<AuditLogFilters>(INITIAL_FILTERS);
  const [detail, setDetail] = useState<AuditRow | null>(null);
  const audit = useAuditLog(filters);

  // setiap ganti filter kembali ke halaman 1
  const setFilter = (patch: Partial<Omit<AuditLogFilters, "page">>) =>
    setFilters((prev) => ({ ...prev, ...patch, page: 1 }));
  const setPage = (page: number) => setFilters((prev) => ({ ...prev, page }));
  const { page } = filters;
  const rows = audit.data?.data ?? [];
  const totalPages = Math.max(1, audit.data?.meta.totalPages ?? 1);

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Settings"
        title="Audit Trail"
        description="Catatan permanen siapa melakukan apa: penyesuaian dan scrap stok, opname, transfer, persetujuan dan pembatalan PO, posting GRN, pembayaran AP beserta void, dan kredit vendor. Baris tidak bisa diubah atau dihapus."
      />

      <Card className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <Combobox
          options={(audit.data?.actors ?? []).map((a) => ({
            value: a.actor_id,
            label: a.actor_name ?? a.actor_id,
          }))}
          value={filters.actorId}
          onChange={(actorId) => setFilter({ actorId })}
          placeholder="Semua pengguna"
          allowClear
        />
        <Select
          value={filters.entity ?? ALL}
          onValueChange={(value) =>
            setFilter({ entity: value && value !== ALL ? String(value) : null })
          }
        >
          <SelectTrigger aria-label="Entitas">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Semua entitas</SelectItem>
            {Object.entries(ENTITY_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.action ?? ALL}
          onValueChange={(value) =>
            setFilter({ action: value && value !== ALL ? String(value) : null })
          }
        >
          <SelectTrigger aria-label="Aksi">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Semua aksi</SelectItem>
            {Object.entries(ACTION_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={filters.search}
          onChange={(e) => setFilter({ search: e.target.value })}
          placeholder="Cari nomor dokumen, alasan, nama"
        />
        <Input
          type="date"
          value={filters.dateFrom}
          onChange={(e) => setFilter({ dateFrom: e.target.value })}
          aria-label="Dari tanggal"
        />
        <Input
          type="date"
          value={filters.dateTo}
          onChange={(e) => setFilter({ dateTo: e.target.value })}
          aria-label="Sampai tanggal"
        />
        <Button
          variant="ghost"
          className="sm:col-span-2 lg:col-span-3 lg:justify-self-end"
          onClick={() => setFilters(INITIAL_FILTERS)}
        >
          <RotateCcw /> Reset filter
        </Button>
      </Card>

      <Card className="py-0">
        {audit.isLoading ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">
            Memuat jejak audit…
          </p>
        ) : audit.error ? (
          <p className="px-5 py-10 text-center text-sm text-danger">{audit.error.message}</p>
        ) : rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">
            Belum ada catatan untuk filter ini.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Waktu</TableHead>
                <TableHead>Aksi</TableHead>
                <TableHead className="hidden md:table-cell">Dokumen</TableHead>
                <TableHead className="hidden lg:table-cell">Oleh</TableHead>
                <TableHead className="text-right">Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap text-sm">
                    {formatDateTime(row.created_at)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={DESTRUCTIVE_ACTIONS.has(row.action) ? "warning" : "secondary"}>
                      {ACTION_LABELS[row.action] ?? row.action}
                    </Badge>
                    <p className="mt-1 text-xs text-muted-foreground md:hidden">
                      {row.entity_label ?? row.entity_id}
                    </p>
                  </TableCell>
                  <TableCell className="hidden md:table-cell max-w-[16rem] whitespace-normal">
                    <p className="font-mono text-sm">{row.entity_label ?? row.entity_id ?? "-"}</p>
                    <p className="text-xs text-muted-foreground">
                      {ENTITY_LABELS[row.entity] ?? row.entity}
                    </p>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-sm">
                    {row.actor_name ?? "Sistem"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setDetail(row)}>
                      Lihat
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Sebelumnya
        </Button>
        <span>
          Halaman {page} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => setPage(page + 1)}
        >
          Berikutnya
        </Button>
      </div>

      {detail && <AuditDetailDialog row={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

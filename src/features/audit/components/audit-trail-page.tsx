"use client";

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { diffAudit } from "@/lib/audit/diff";

type AuditRow = {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  entity_label: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  ip: string | null;
};

const ACTION_LABELS: Record<string, string> = {
  "stock.adjust": "Penyesuaian stok",
  "stock.opname_complete": "Opname selesai",
  "stock.scrap": "Scrap / write-off",
  "stock.transfer": "Transfer stok",
  "po.approve": "PO disetujui",
  "po.cancel": "PO dibatalkan",
  "grn.post": "GRN diposting",
  "ap_payment.create": "Pembayaran AP",
  "ap_payment.void": "Void pembayaran AP",
  "vendor_credit.approve": "Kredit vendor disetujui",
  "vendor_credit.apply": "Kredit vendor dipakai",
  "purchase_return.revise": "Revisi retur",
};

const ENTITY_LABELS: Record<string, string> = {
  inventory: "Stok",
  stock_opname: "Stok opname",
  stock_transfer: "Transfer stok",
  purchase_order: "Purchase order",
  grn: "GRN",
  ap_payment: "Pembayaran AP",
  vendor_credit: "Kredit vendor",
  purchase_return: "Retur pembelian",
};

const DESTRUCTIVE = new Set(["ap_payment.void", "po.cancel", "stock.scrap"]);
const ALL = "all";

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

/** Settings → Audit Trail: jejak append-only aksi stok, pembelian, dan hutang. */
export function AuditTrailPage() {
  const [actorId, setActorId] = useState("");
  const [entity, setEntity] = useState(ALL);
  const [action, setAction] = useState(ALL);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<AuditRow | null>(null);

  const params = new URLSearchParams({ page: String(page), limit: "30" });
  if (actorId) params.set("actor_id", actorId);
  if (entity !== ALL) params.set("entity", entity);
  if (action !== ALL) params.set("action", action);
  if (search.trim()) params.set("search", search.trim());
  if (dateFrom) params.set("date_from", dateFrom);
  if (dateTo) params.set("date_to", dateTo);

  const audit = useQuery({
    queryKey: ["audit-log", params.toString()],
    queryFn: async () => {
      const res = await fetch(`/api/audit?${params.toString()}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || body.error || "Gagal memuat audit");
      return body as {
        data: AuditRow[];
        actors: { actor_id: string; actor_name: string | null }[];
        meta: { total: number; totalPages: number };
      };
    },
    placeholderData: keepPreviousData,
  });

  const resetPage = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setPage(1);
  };
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
          options={(audit.data?.actors ?? []).map((a) => ({ value: a.actor_id, label: a.actor_name ?? a.actor_id }))}
          value={actorId}
          onChange={resetPage(setActorId)}
          placeholder="Semua pengguna"
          allowClear
        />
        <Select value={entity} onValueChange={(value) => resetPage(setEntity)(String(value ?? ALL))}>
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
        <Select value={action} onValueChange={(value) => resetPage(setAction)(String(value ?? ALL))}>
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
          value={search}
          onChange={(e) => resetPage(setSearch)(e.target.value)}
          placeholder="Cari nomor dokumen, alasan, nama"
        />
        <Input type="date" value={dateFrom} onChange={(e) => resetPage(setDateFrom)(e.target.value)} aria-label="Dari tanggal" />
        <Input type="date" value={dateTo} onChange={(e) => resetPage(setDateTo)(e.target.value)} aria-label="Sampai tanggal" />
        <Button
          variant="ghost"
          className="sm:col-span-2 lg:col-span-3 lg:justify-self-end"
          onClick={() => {
            setActorId("");
            setEntity(ALL);
            setAction(ALL);
            setSearch("");
            setDateFrom("");
            setDateTo("");
            setPage(1);
          }}
        >
          <RotateCcw /> Reset filter
        </Button>
      </Card>

      <Card className="py-0">
        {audit.isLoading ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">Memuat jejak audit…</p>
        ) : audit.error ? (
          <p className="px-5 py-10 text-center text-sm text-danger">{audit.error.message}</p>
        ) : rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">Belum ada catatan untuk filter ini.</p>
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
                  <TableCell className="whitespace-nowrap text-sm">{formatDateTime(row.created_at)}</TableCell>
                  <TableCell>
                    <Badge variant={DESTRUCTIVE.has(row.action) ? "warning" : "secondary"}>
                      {ACTION_LABELS[row.action] ?? row.action}
                    </Badge>
                    <p className="mt-1 text-xs text-muted-foreground md:hidden">{row.entity_label ?? row.entity_id}</p>
                  </TableCell>
                  <TableCell className="hidden md:table-cell max-w-[16rem] whitespace-normal">
                    <p className="font-mono text-sm">{row.entity_label ?? row.entity_id ?? "-"}</p>
                    <p className="text-xs text-muted-foreground">{ENTITY_LABELS[row.entity] ?? row.entity}</p>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-sm">{row.actor_name ?? "Sistem"}</TableCell>
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
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Sebelumnya
        </Button>
        <span>
          Halaman {page} / {totalPages}
        </span>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
          Berikutnya
        </Button>
      </div>

      {detail && <AuditDetailDialog row={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function AuditDetailDialog({ row, onClose }: { row: AuditRow; onClose: () => void }) {
  const changes = diffAudit(row.before, row.after);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="lg">
        <DialogPanelHeader>
          <DialogPanelTitle>{ACTION_LABELS[row.action] ?? row.action}</DialogPanelTitle>
          <DialogPanelDescription>
            {row.entity_label ?? row.entity_id} · {row.actor_name ?? "Sistem"} · {formatDateTime(row.created_at)}
            {row.ip ? ` · IP ${row.ip}` : ""}
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-4">
          {row.reason && (
            <div className="rounded-2xl bg-surface px-4 py-3 text-sm">
              <p className="font-medium">Alasan</p>
              <p className="mt-1 text-body">{row.reason}</p>
            </div>
          )}
          {changes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Tidak ada perubahan field yang tercatat.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Field</TableHead>
                  <TableHead>Sebelum</TableHead>
                  <TableHead>Sesudah</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {changes.map((change) => (
                  <TableRow key={change.field}>
                    <TableCell className="font-mono text-xs">{change.field}</TableCell>
                    <TableCell className="max-w-[14rem] whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">
                      {formatValue(change.before)}
                    </TableCell>
                    <TableCell className="max-w-[14rem] whitespace-pre-wrap break-words font-mono text-xs">
                      {formatValue(change.after)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogPanelBody>
      </DialogPanel>
    </Dialog>
  );
}

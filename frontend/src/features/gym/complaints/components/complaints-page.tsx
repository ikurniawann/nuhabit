"use client";

import { useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlarmClock, Inbox, Plus, RotateCcw, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Can } from "@/components/iam/can";
import { useCan } from "@/components/iam/iam-access-provider";
import { Field, TableNote } from "@/features/crm/engagement/components/shared";
import { SELECT } from "@/features/gym/shared";
import { useDebounced } from "@/features/gym/use-debounced";
import { formatDateTime, formatNumber } from "@/lib/format";
import {
  COMPLAINT_KEYS,
  EMPTY_FILTERS,
  PAGE_SIZE,
  PRIORITIES,
  PRIORITY_LABEL,
  SOURCE_LABEL,
  STATUS_LABEL,
  complaintsApi,
  listQuery,
  reporterName,
  ticketHref,
  type ComplaintSource,
  type ComplaintStatus,
  type ListFilters,
} from "../api";
import { ComplaintReport } from "./complaint-report";
import { ComplaintSettings } from "./complaint-settings";
import { NewTicketDialog } from "./new-ticket-dialog";
import { DeadlineText, PriorityBadge, StatusBadge } from "./ticket-bits";

const MENU = "gym.complaints";

/** Gym → Keluhan: tiket keluhan member, laporan, dan pengaturan SLA serta eskalasi. */
export function ComplaintsPage() {
  const canManage = useCan(MENU, "delete");
  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Gym & Kelas"
        title="Keluhan"
        description="Keluhan dan masukan member dari WhatsApp, front desk, dan aplikasi member. Tiket yang lewat batas waktu dieskalasi ke head coach atau ops cabang."
      />
      <Tabs defaultValue="tiket" className="w-full flex-col">
        <TabsList variant="line">
          <TabsTrigger value="tiket">Tiket</TabsTrigger>
          <TabsTrigger value="laporan">Laporan</TabsTrigger>
          {canManage && <TabsTrigger value="pengaturan">Pengaturan</TabsTrigger>}
        </TabsList>
        <TabsContent value="tiket" className="mt-4">
          <TicketList />
        </TabsContent>
        <TabsContent value="laporan" className="mt-4">
          <ComplaintReport />
        </TabsContent>
        {canManage && (
          <TabsContent value="pengaturan" className="mt-4">
            <ComplaintSettings />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "active", label: "Belum dikonfirmasi" },
  { value: "open", label: "Perlu ditangani" },
  ...(Object.keys(STATUS_LABEL) as ComplaintStatus[]).map((s) => ({ value: s, label: STATUS_LABEL[s] })),
  { value: "", label: "Semua status" },
];

function TicketList() {
  const [filters, setFilters] = useState<ListFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const q = useDebounced(filters.q, 300);
  const query = listQuery({ ...filters, q }, page);
  const list = useQuery({ queryKey: COMPLAINT_KEYS.list(query), queryFn: () => complaintsApi.list(query), placeholderData: keepPreviousData });
  const options = useQuery({ queryKey: COMPLAINT_KEYS.options, queryFn: complaintsApi.options });
  const counts = list.data?.counts ?? {};
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / PAGE_SIZE));
  const now = new Date();
  const set = <K extends keyof ListFilters>(key: K, value: ListFilters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(0);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Baru diterima" value={formatNumber(counts.received ?? 0)} icon={<Inbox />} tone="info" />
        <StatCard label="Ditangani" value={formatNumber(counts.in_progress ?? 0)} icon={<Wrench />} tone="warning" />
        <StatCard label="Dibuka lagi" value={formatNumber(counts.reopened ?? 0)} icon={<RotateCcw />} tone="danger" />
        <StatCard label="Menunggu konfirmasi member" value={formatNumber(counts.resolved ?? 0)} icon={<AlarmClock />} tone="success" />
      </div>
      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Status">
            <select className={SELECT} value={filters.status} onChange={(e) => set("status", e.target.value)}>
              {STATUS_FILTERS.map((s) => (
                <option key={s.value || "all"} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Kategori">
            <select className={SELECT} value={filters.category} onChange={(e) => set("category", e.target.value)}>
              <option value="">Semua kategori</option>
              {options.data?.categories.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Prioritas">
            <select className={SELECT} value={filters.priority} onChange={(e) => set("priority", e.target.value)}>
              <option value="">Semua prioritas</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Sumber">
            <select className={SELECT} value={filters.source} onChange={(e) => set("source", e.target.value)}>
              <option value="">Semua sumber</option>
              {(Object.keys(SOURCE_LABEL) as ComplaintSource[]).map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Cabang">
            <select className={SELECT} value={filters.branch_id} onChange={(e) => set("branch_id", e.target.value)}>
              <option value="">Semua cabang</option>
              {options.data?.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="PIC">
            <select className={SELECT} value={filters.owner} onChange={(e) => set("owner", e.target.value)}>
              <option value="">Semua PIC</option>
              <option value="me">Tiket saya</option>
              {options.data?.staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Cari">
            <Input value={filters.q} placeholder="Kode, judul, atau pelapor" onChange={(e) => set("q", e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" checked={filters.overdue} onChange={(e) => set("overdue", e.target.checked)} className="size-4" />
            Hanya yang lewat batas waktu
          </label>
        </div>
      </Card>
      <div className="flex justify-end">
        <Can menu={MENU} action="create" mode="disable">
          <Button onClick={() => setCreating(true)}>
            <Plus /> Buat tiket
          </Button>
        </Can>
      </div>
      <Card className="py-0">
        {list.isLoading ? (
          <TableNote>Memuat tiket…</TableNote>
        ) : list.error ? (
          <TableNote tone="danger">{list.error.message}</TableNote>
        ) : !list.data || list.data.rows.length === 0 ? (
          <TableNote>Tidak ada tiket untuk filter ini.</TableNote>
        ) : (
          <Table aria-label="Daftar tiket keluhan">
            <TableHeader>
              <TableRow>
                <TableHead>Tiket</TableHead>
                <TableHead>Pelapor</TableHead>
                <TableHead>Kategori</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Batas waktu</TableHead>
                <TableHead>PIC</TableHead>
                <TableHead>Masuk</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.rows.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="max-w-72">
                    <Link href={ticketHref(t.id)} className="block font-medium hover:underline">
                      {t.code}
                    </Link>
                    <span className="block truncate text-xs text-muted-foreground">{t.title}</span>
                  </TableCell>
                  <TableCell>
                    <span className="block">{reporterName(t)}</span>
                    <span className="block text-xs text-muted-foreground">{SOURCE_LABEL[t.source]}</span>
                  </TableCell>
                  <TableCell>
                    <span className="block">{t.category_label}</span>
                    <PriorityBadge priority={t.priority} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={t.status} />
                  </TableCell>
                  <TableCell className="text-sm">
                    <DeadlineText ticket={t} now={now} />
                  </TableCell>
                  <TableCell>{t.owner_name ?? <span className="text-muted-foreground">Belum ada</span>}</TableCell>
                  <TableCell className="text-sm whitespace-nowrap">{formatDateTime(t.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Sebelumnya
          </Button>
          <span>
            Halaman {page + 1} dari {pages}
          </span>
          <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
            Berikutnya
          </Button>
        </div>
      )}
      {creating && <NewTicketDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

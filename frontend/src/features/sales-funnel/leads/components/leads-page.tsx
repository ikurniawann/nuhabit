"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowUpTrayIcon,
  PlusIcon,
  UserPlusIcon,
} from "@heroicons/react/24/outline";
import { Loader2, MessageCircle, Search, TrendingUp, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TableRow } from "@/components/ui/table";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { MasterTableActions } from "@/features/master-data/components/master-table-actions";
import { DealFormDialog } from "@/features/sales-funnel/pipeline";
import { useDeleteLead, useLeads } from "../queries";
import { LeadFormDialog } from "./lead-form-dialog";
import { LeadImportDialog } from "./lead-import-dialog";
import { ScoreBadge } from "./score-badge";
import {
  ORG_TYPE_LABELS,
  SOURCE_LABELS,
  STATUS_LABELS,
  TEMPERATURE_LABELS,
  type LeadStatus,
  type LeadTemperature,
  type SalesLead,
} from "../types";

const ALL = "all";

const STATUS_BADGE: Record<LeadStatus, string> = {
  baru: "border-0 bg-blue-100 font-normal text-blue-700",
  dihubungi: "border-0 bg-amber-100 font-normal text-amber-700",
  qualified: "border-0 bg-emerald-100 font-normal text-emerald-700",
  "tidak-cocok": "border-0 bg-gray-100 font-normal text-gray-500",
};

const TEMPERATURE_BADGE: Record<LeadTemperature, string> = {
  panas: "border-0 bg-red-100 font-normal text-red-700",
  hangat: "border-0 bg-orange-100 font-normal text-orange-700",
  dingin: "border-0 bg-sky-100 font-normal text-sky-700",
};

export function SalesFunnelLeadsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(ALL);
  const [orgType, setOrgType] = useState(ALL);
  const [source, setSource] = useState(ALL);
  const [sort, setSort] = useState<"score" | "newest">("score");
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<SalesLead | null>(null);
  const [deletingLead, setDeletingLead] = useState<SalesLead | null>(null);
  const [convertingLead, setConvertingLead] = useState<SalesLead | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => setSearch(searchQuery.trim()), 300);
    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  const filters = useMemo(
    () => ({
      q: search,
      status: status === ALL ? "" : status,
      org_type: orgType === ALL ? "" : orgType,
      source: source === ALL ? "" : source,
      page,
      sort,
    }),
    [search, status, orgType, source, page, sort]
  );

  const { data, isLoading } = useLeads(filters);
  const deleteMutation = useDeleteLead();

  const leads = data?.data ?? [];
  const pagination = data?.pagination;
  const total = pagination?.total ?? 0;
  const totalPages = pagination?.totalPages ?? 1;
  const hasFilter =
    Boolean(search) || status !== ALL || orgType !== ALL || source !== ALL;

  const openCreate = () => {
    setEditingLead(null);
    setFormOpen(true);
  };
  const openEdit = (lead: SalesLead) => {
    setEditingLead(lead);
    setFormOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leads</h1>
          <p className="mt-1 text-sm text-gray-500">
            Prospek B2B corporate, sekolah, komunitas & acara privat — {total} lead terdaftar
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Button
            type="button"
            variant="outline"
            onClick={() => setImportOpen(true)}
            className="h-10 w-full gap-2 rounded-lg border-pink-200 px-3 text-sm font-semibold text-pink-700 hover:bg-pink-50 sm:w-auto"
          >
            <ArrowUpTrayIcon className="h-4 w-4" />
            Import CSV
          </Button>
          <Button
            type="button"
            onClick={openCreate}
            className="h-10 w-full gap-2 rounded-lg bg-pink-600 px-3 text-sm font-semibold text-white shadow-sm hover:bg-pink-700 sm:w-auto"
          >
            <PlusIcon className="h-4 w-4" />
            Tambah Lead
          </Button>
        </div>
      </div>

      <PurchasingListSection
        icon={UserPlusIcon}
        title="Daftar Leads"
        description="Kelola prospek beserta PIC-nya sebelum masuk pipeline deal."
        toolbar={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <label className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="Cari instansi, PIC, no. WA..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                className="h-10 bg-white pl-9 pr-9 text-sm focus:border-pink-400 focus:ring-2 focus:ring-pink-100"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                  aria-label="Hapus pencarian"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </label>
            <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
              <SelectTrigger className="h-10 bg-white sm:w-36">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Semua Status</SelectItem>
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={orgType} onValueChange={(v) => { setOrgType(v); setPage(1); }}>
              <SelectTrigger className="h-10 bg-white sm:w-40">
                <SelectValue placeholder="Jenis Instansi" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Semua Jenis</SelectItem>
                {Object.entries(ORG_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={source} onValueChange={(v) => { setSource(v); setPage(1); }}>
              <SelectTrigger className="h-10 bg-white sm:w-36">
                <SelectValue placeholder="Sumber" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Semua Sumber</SelectItem>
                {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      >
        {isLoading ? (
          <div className="py-14 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" />
            <p className="mt-2 text-sm text-gray-500">Memuat data leads...</p>
          </div>
        ) : leads.length === 0 ? (
          <div className="py-14 text-center">
            <UserPlusIcon className="mx-auto mb-4 h-12 w-12 text-gray-300" />
            <p className="text-gray-500">
              {hasFilter ? "Tidak ada lead yang cocok" : "Belum ada lead"}
            </p>
            {!hasFilter ? (
              <Button
                type="button"
                variant="outline"
                onClick={openCreate}
                className="mt-4 h-10 rounded-lg border-pink-200 text-pink-700 hover:bg-pink-50"
              >
                Tambah Lead Pertama
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto px-4 pb-4">
              <table className="w-full text-sm">
                <thead>
                  <TableRow className="border-b border-gray-200/70 bg-gray-50/80 text-xs uppercase tracking-wide text-gray-500 hover:bg-gray-50/80">
                    <th className="px-4 py-3 text-left font-semibold">Instansi</th>
                    <th className="px-4 py-3 text-left font-semibold">PIC</th>
                    <th className="px-4 py-3 text-left font-semibold">Kota</th>
                    <th className="px-4 py-3 text-left font-semibold">Sumber</th>
                    <th className="px-4 py-3 text-left font-semibold">Suhu</th>
                    <th className="px-4 py-3 text-left font-semibold">
                      <button type="button" onClick={() => setSort((v) => (v === "score" ? "newest" : "score"))} title="Klik untuk ganti urutan" className="uppercase tracking-wide hover:text-pink-700">
                        Skor {sort === "score" ? "↓" : ""}
                      </button>
                    </th>
                    <th className="px-4 py-3 text-left font-semibold">Status</th>
                    <th className="px-4 py-3 text-left font-semibold">Penanggung Jawab</th>
                    <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                  </TableRow>
                </thead>
                <tbody className="divide-y divide-gray-200/50">
                  {leads.map((lead) => (
                    <TableRow key={lead.id} className="hover:bg-gray-50/80">
                      <td className="px-4 py-3">
                        <Link
                          href={`/dashboard/sales-funnel/leads/${lead.id}`}
                          className="font-medium text-gray-900 hover:text-pink-600 hover:underline"
                        >
                          {lead.org_name}
                        </Link>
                        <div className="text-xs text-gray-500">
                          {ORG_TYPE_LABELS[lead.org_type]}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-gray-900">{lead.pic_name}</div>
                        <div className="flex items-center gap-1.5 text-xs text-gray-500">
                          <span className="font-mono">{lead.pic_phone}</span>
                          <a
                            href={`https://wa.me/${lead.pic_phone}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Chat WA"
                            className="text-emerald-600 hover:text-emerald-700"
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                          </a>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-500">{lead.city || "—"}</td>
                      <td className="px-4 py-3 text-gray-500">
                        {SOURCE_LABELS[lead.source]}
                      </td>
                      <td className="px-4 py-3">
                        <Badge className={TEMPERATURE_BADGE[lead.temperature]}>
                          {TEMPERATURE_LABELS[lead.temperature]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <ScoreBadge score={lead.score ?? 0} />
                      </td>
                      <td className="px-4 py-3">
                        <Badge className={STATUS_BADGE[lead.status]}>
                          {STATUS_LABELS[lead.status]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {lead.owner_name || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {lead.status !== "tidak-cocok" ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => setConvertingLead(lead)}
                              className="h-8 w-8 p-0 text-gray-600 hover:bg-pink-50 hover:text-pink-600"
                              aria-label="Konversi ke Deal"
                              title="Konversi ke Deal"
                            >
                              <TrendingUp className="h-4 w-4" />
                            </Button>
                          ) : null}
                          <MasterTableActions
                            onEdit={() => openEdit(lead)}
                            onDelete={() => setDeletingLead(lead)}
                          />
                        </div>
                      </td>
                    </TableRow>
                  ))}
                </tbody>
              </table>
            </div>
            {pagination && total > pagination.limit ? (
              <div className="flex flex-col items-center justify-between gap-2 border-t border-gray-100 px-5 py-3 text-sm text-gray-500 sm:flex-row">
                <span>
                  {total} lead — halaman {pagination.page} dari {totalPages}
                </span>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                    className="h-9 rounded-lg border-gray-200/80"
                  >
                    Sebelumnya
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    className="h-9 rounded-lg border-gray-200/80"
                  >
                    Berikutnya
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </PurchasingListSection>

      <LeadFormDialog open={formOpen} onOpenChange={setFormOpen} lead={editingLead} />
      <LeadImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <DealFormDialog
        open={convertingLead !== null}
        onOpenChange={(open) => !open && setConvertingLead(null)}
        deal={null}
        initialLead={convertingLead}
      />
      <ConfirmDialog
        open={deletingLead !== null}
        onOpenChange={(open) => !open && setDeletingLead(null)}
        title="Hapus lead?"
        description={`Lead "${deletingLead?.org_name ?? ""}" akan dihapus. Deal yang sudah dibuat dari lead ini tidak ikut terhapus.`}
        confirmLabel="Hapus"
        variant="danger"
        onConfirm={() => {
          if (deletingLead) deleteMutation.mutate(deletingLead.id);
          setDeletingLead(null);
        }}
      />
    </div>
  );
}

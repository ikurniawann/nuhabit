"use client";

import { formatDate, formatRupiah } from "@/lib/format";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BuildingOffice2Icon, PlusIcon } from "@heroicons/react/24/outline";
import { Loader2, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
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
import { ORG_TYPE_LABELS } from "../../leads/types";
import { useAccounts, useDeleteAccount } from "../queries";
import type { SalesAccount } from "../types";
import { AccountFormDialog } from "./account-form-dialog";

const ALL = "all";

function relative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "hari ini";
  if (days === 1) return "kemarin";
  if (days < 30) return `${days} hari lalu`;
  return formatDate(iso);
}

/** EPIC-050 T-1.3 — daftar Account (instansi/perusahaan B2B). */
export function SalesAccountsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [search, setSearch] = useState("");
  const [accountType, setAccountType] = useState(ALL);
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SalesAccount | null>(null);
  const [deleting, setDeleting] = useState<SalesAccount | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => setSearch(searchQuery.trim()), 300);
    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  const filters = useMemo(
    () => ({ q: search, account_type: accountType === ALL ? "" : accountType, city: "", page }),
    [search, accountType, page]
  );
  const { data, isLoading } = useAccounts(filters);
  const deleteMutation = useDeleteAccount();

  const accounts = data?.data ?? [];
  const pagination = data?.pagination;
  const total = pagination?.total ?? 0;
  const totalPages = pagination?.totalPages ?? 1;
  const hasFilter = Boolean(search) || accountType !== ALL;

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Accounts</h1>
          <p className="mt-1 text-sm text-gray-500">
            Instansi & perusahaan B2B beserta contact, lead, dan deal-nya — {total} account
          </p>
        </div>
        <Button type="button" onClick={openCreate} className="h-10 w-full gap-2 rounded-lg bg-pink-600 px-3 text-sm font-semibold text-white shadow-sm hover:bg-pink-700 sm:w-auto">
          <PlusIcon className="h-4 w-4" /> Tambah Account
        </Button>
      </div>

      <PurchasingListSection
        icon={BuildingOffice2Icon}
        title="Daftar Account"
        description="Lead baru otomatis membuat/menautkan account berdasarkan nama instansi."
        toolbar={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <label className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="Cari nama, kota, contact…"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                className="h-10 bg-white pl-9 pr-9 text-sm"
              />
              {searchQuery ? (
                <button type="button" onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700" aria-label="Hapus pencarian">
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </label>
            <Select value={accountType} onValueChange={(v) => { setAccountType(v); setPage(1); }}>
              <SelectTrigger className="h-10 bg-white sm:w-40"><SelectValue placeholder="Jenis" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Semua Jenis</SelectItem>
                {Object.entries(ORG_TYPE_LABELS).map(([value, label]) => (
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
            <p className="mt-2 text-sm text-gray-500">Memuat accounts...</p>
          </div>
        ) : accounts.length === 0 ? (
          <div className="py-14 text-center">
            <BuildingOffice2Icon className="mx-auto mb-4 h-12 w-12 text-gray-300" />
            <p className="text-gray-500">{hasFilter ? "Tidak ada account yang cocok" : "Belum ada account"}</p>
            {!hasFilter ? (
              <Button type="button" variant="outline" onClick={openCreate} className="mt-4 h-10 rounded-lg border-pink-200 text-pink-700 hover:bg-pink-50">
                Tambah Account Pertama
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto px-4 pb-4">
              <table className="w-full text-sm">
                <thead>
                  <TableRow className="border-b border-gray-200/70 bg-gray-50/80 text-xs uppercase tracking-wide text-gray-500 hover:bg-gray-50/80">
                    <th className="px-4 py-3 text-left font-semibold">Account</th>
                    <th className="px-4 py-3 text-left font-semibold">Jenis</th>
                    <th className="px-4 py-3 text-left font-semibold">Kota</th>
                    <th className="px-4 py-3 text-right font-semibold">Contact</th>
                    <th className="px-4 py-3 text-right font-semibold">Lead</th>
                    <th className="px-4 py-3 text-right font-semibold">Deal Terbuka</th>
                    <th className="px-4 py-3 text-right font-semibold">Nilai Menang</th>
                    <th className="px-4 py-3 text-left font-semibold">Aktivitas Terakhir</th>
                    <th className="px-4 py-3 text-left font-semibold">PJ</th>
                    <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                  </TableRow>
                </thead>
                <tbody className="divide-y divide-gray-200/50">
                  {accounts.map((account) => (
                    <TableRow key={account.id} className="hover:bg-gray-50/80">
                      <td className="px-4 py-3">
                        <Link href={`/dashboard/sales-funnel/accounts/${account.id}`} className="font-medium text-gray-900 hover:text-pink-700 hover:underline">
                          {account.name}
                        </Link>
                        {account.industry ? <p className="text-xs text-gray-500">{account.industry}</p> : null}
                      </td>
                      <td className="px-4 py-3">
                        <Badge className="border-0 bg-gray-100 font-normal text-gray-600">{ORG_TYPE_LABELS[account.account_type]}</Badge>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{account.city ?? "—"}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{account.contact_count ?? 0}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{account.lead_count ?? 0}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{account.open_deal_count ?? 0}</td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">{formatRupiah(account.won_value)}</td>
                      <td className="px-4 py-3 text-gray-600">{relative(account.last_activity_at)}</td>
                      <td className="px-4 py-3 text-gray-600">{account.owner_name ?? "—"}</td>
                      <td className="px-4 py-3">
                        <MasterTableActions onEdit={() => { setEditing(account); setFormOpen(true); }} onDelete={() => setDeleting(account)} />
                      </td>
                    </TableRow>
                  ))}
                </tbody>
              </table>
            </div>
            {pagination && total > pagination.limit ? (
              <div className="flex flex-col items-center justify-between gap-2 border-t border-gray-100 px-5 py-3 text-sm text-gray-500 sm:flex-row">
                <span>{total} account — halaman {pagination.page} dari {totalPages}</span>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="h-9 rounded-lg border-gray-200/80">Sebelumnya</Button>
                  <Button type="button" variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="h-9 rounded-lg border-gray-200/80">Berikutnya</Button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </PurchasingListSection>

      <AccountFormDialog open={formOpen} onOpenChange={setFormOpen} account={editing} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Hapus account?"
        description={`Account "${deleting?.name ?? ""}" akan dihapus. Contact-nya dilepas (tidak ikut terhapus). Account yang masih punya lead aktif tidak bisa dihapus.`}
        confirmLabel="Hapus"
        variant="danger"
        onConfirm={() => {
          if (deleting) deleteMutation.mutate(deleting.id);
          setDeleting(null);
        }}
      />
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PlusIcon, UsersIcon } from "@heroicons/react/24/outline";
import { CalendarPlus, History, Loader2, MessageCircle, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TableRow } from "@/components/ui/table";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { MasterTableActions } from "@/features/master-data/components/master-table-actions";
import { RecordTimeline } from "@/features/sales-funnel/timeline";
import { TaskFormDialog, useUpdateTask } from "@/features/sales-funnel/tasks";
import { useContacts, useDeleteContact } from "../queries";
import type { SalesContact } from "../types";
import { ContactFormDialog } from "./contact-form-dialog";

/** EPIC-050 T-1.3 — daftar Contact (PIC) lintas account. */
export function SalesContactsPage() {
  const searchParams = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(searchParams.get("q") ?? "");
  const [search, setSearch] = useState(searchParams.get("q") ?? "");
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SalesContact | null>(null);
  const [deleting, setDeleting] = useState<SalesContact | null>(null);
  const [timelineFor, setTimelineFor] = useState<SalesContact | null>(null);
  const [taskFor, setTaskFor] = useState<SalesContact | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => setSearch(searchQuery.trim()), 300);
    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  const accountId = searchParams.get("account_id") ?? "";
  const filters = useMemo(() => ({ q: search, account_id: accountId, page }), [search, accountId, page]);
  const { data, isLoading } = useContacts(filters);
  const deleteMutation = useDeleteContact();
  const completeTask = useUpdateTask();

  const contacts = data?.data ?? [];
  const pagination = data?.pagination;
  const total = pagination?.total ?? 0;
  const totalPages = pagination?.totalPages ?? 1;

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Contacts</h1>
          <p className="mt-1 text-sm text-gray-500">PIC dari setiap account — satu nomor WA = satu contact. {total} contact terdaftar</p>
        </div>
        <Button type="button" onClick={openCreate} className="h-10 w-full gap-2 rounded-lg bg-pink-600 px-3 text-sm font-semibold text-white shadow-sm hover:bg-pink-700 sm:w-auto">
          <PlusIcon className="h-4 w-4" /> Tambah Contact
        </Button>
      </div>

      <PurchasingListSection
        icon={UsersIcon}
        title="Daftar Contact"
        description="Lead baru otomatis membuat/menautkan contact berdasarkan nomor WA PIC."
        toolbar={
          <label className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Cari nama, no. WA, email, account…"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
              className="h-10 bg-white pl-9 pr-9 text-sm"
            />
            {searchQuery ? (
              <button type="button" onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700" aria-label="Hapus pencarian">
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </label>
        }
      >
        {isLoading ? (
          <div className="py-14 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" />
            <p className="mt-2 text-sm text-gray-500">Memuat contacts...</p>
          </div>
        ) : contacts.length === 0 ? (
          <div className="py-14 text-center">
            <UsersIcon className="mx-auto mb-4 h-12 w-12 text-gray-300" />
            <p className="text-gray-500">{search || accountId ? "Tidak ada contact yang cocok" : "Belum ada contact"}</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto px-4 pb-4">
              <table className="w-full text-sm">
                <thead>
                  <TableRow className="border-b border-gray-200/70 bg-gray-50/80 text-xs uppercase tracking-wide text-gray-500 hover:bg-gray-50/80">
                    <th className="px-4 py-3 text-left font-semibold">Nama</th>
                    <th className="px-4 py-3 text-left font-semibold">Account</th>
                    <th className="px-4 py-3 text-left font-semibold">No. WA</th>
                    <th className="px-4 py-3 text-left font-semibold">Email</th>
                    <th className="px-4 py-3 text-right font-semibold">Lead</th>
                    <th className="px-4 py-3 text-left font-semibold">PJ</th>
                    <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                  </TableRow>
                </thead>
                <tbody className="divide-y divide-gray-200/50">
                  {contacts.map((contact) => (
                    <TableRow key={contact.id} className="hover:bg-gray-50/80">
                      <td className="px-4 py-3">
                        <span className="font-medium text-gray-900">{contact.name}</span>
                        {contact.is_primary ? <Badge className="ml-1.5 border-0 bg-pink-100 font-normal text-pink-700">utama</Badge> : null}
                        {contact.title ? <p className="text-xs text-gray-500">{contact.title}</p> : null}
                      </td>
                      <td className="px-4 py-3">
                        {contact.account_id ? (
                          <Link href={`/dashboard/sales-funnel/accounts/${contact.account_id}`} className="text-pink-600 hover:underline">{contact.account_name}</Link>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-700">
                        {contact.phone}
                        <a href={`https://wa.me/${contact.phone}`} target="_blank" rel="noopener noreferrer" className="ml-1.5 inline-flex align-middle text-emerald-600 hover:text-emerald-700" title="Chat WA">
                          <MessageCircle className="h-3.5 w-3.5" />
                        </a>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{contact.email ?? "—"}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{contact.lead_count ?? 0}</td>
                      <td className="px-4 py-3 text-gray-600">{contact.owner_name ?? "—"}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button type="button" size="sm" variant="outline" className="h-8 gap-1 px-2 text-xs" onClick={() => setTaskFor(contact)} title="Tambah task">
                            <CalendarPlus className="h-3.5 w-3.5" />
                          </Button>
                          <Button type="button" size="sm" variant="outline" className="h-8 gap-1 px-2 text-xs" onClick={() => setTimelineFor(contact)} title="Timeline">
                            <History className="h-3.5 w-3.5" />
                          </Button>
                          <MasterTableActions onEdit={() => { setEditing(contact); setFormOpen(true); }} onDelete={() => setDeleting(contact)} />
                        </div>
                      </td>
                    </TableRow>
                  ))}
                </tbody>
              </table>
            </div>
            {pagination && total > pagination.limit ? (
              <div className="flex flex-col items-center justify-between gap-2 border-t border-gray-100 px-5 py-3 text-sm text-gray-500 sm:flex-row">
                <span>{total} contact — halaman {pagination.page} dari {totalPages}</span>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="h-9 rounded-lg border-gray-200/80">Sebelumnya</Button>
                  <Button type="button" variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="h-9 rounded-lg border-gray-200/80">Berikutnya</Button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </PurchasingListSection>

      <ContactFormDialog open={formOpen} onOpenChange={setFormOpen} contact={editing} defaultAccountId={accountId || null} />
      <TaskFormDialog
        open={taskFor !== null}
        onOpenChange={(open) => !open && setTaskFor(null)}
        subject={taskFor ? { subject_type: "contact", subject_id: taskFor.id, label: taskFor.name } : null}
      />
      <Dialog open={timelineFor !== null} onOpenChange={(open) => !open && setTimelineFor(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Timeline — {timelineFor?.name}</DialogTitle>
          </DialogHeader>
          {timelineFor ? (
            <RecordTimeline
              subjectType="contact"
              subjectId={timelineFor.id}
              onCompleteTask={(taskId) => completeTask.mutate({ id: taskId, values: { status: "done" } })}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Hapus contact?"
        description={`Contact "${deleting?.name ?? ""}" akan dihapus. Lead yang menautkannya dilepas (tidak ikut terhapus).`}
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

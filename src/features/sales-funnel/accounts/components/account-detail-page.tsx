"use client";

import { formatDate, formatDateTime, formatRupiah } from "@/lib/format";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  CalendarPlus,
  Loader2,
  MessageCircle,
  Pencil,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { RecordTimeline } from "@/features/sales-funnel/timeline";
import { TaskFormDialog, useUpdateTask } from "@/features/sales-funnel/tasks";
import { ContactFormDialog } from "@/features/sales-funnel/contacts";
import type { SalesContact } from "@/features/sales-funnel/contacts";
import { ORG_TYPE_LABELS, STATUS_LABELS, TEMPERATURE_LABELS } from "../../leads/types";
import type { LeadStatus, LeadTemperature } from "../../leads/types";
import { useAccountDetail, useDeleteAccount } from "../queries";
import type { AccountContactSummary } from "../types";
import { AccountFormDialog } from "./account-form-dialog";


function contactToSalesContact(c: AccountContactSummary, accountId: string, companyId: string, branchId: string, accountName: string): SalesContact {
  return {
    id: c.id,
    company_id: companyId,
    branch_id: branchId,
    account_id: accountId,
    account_name: accountName,
    account_type: null,
    name: c.name,
    title: c.title,
    phone: c.phone,
    email: c.email,
    is_primary: c.is_primary,
    customer_id: c.customer_id,
    notes: null,
    owner_user_id: null,
    owner_name: c.owner_name,
    custom: {},
    created_at: c.created_at,
    updated_at: c.created_at,
  };
}

/** EPIC-050 T-1.3 — Account 360°: profil, contacts, leads, deals, quotation/invoice, tasks, timeline. */
export function AccountDetailPage({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [contactFormOpen, setContactFormOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<SalesContact | null>(null);
  const [taskOpen, setTaskOpen] = useState(false);

  const detailQuery = useAccountDetail(accountId);
  const deleteMutation = useDeleteAccount(() => router.push("/dashboard/sales-funnel/accounts"));
  const completeTask = useUpdateTask();
  const detail = detailQuery.data;

  if (detailQuery.isLoading) {
    return (
      <div className="py-24 text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" />
        <p className="mt-2 text-sm text-gray-500">Memuat account...</p>
      </div>
    );
  }
  if (detailQuery.isError || !detail) {
    return (
      <div className="py-24 text-center">
        <p className="text-gray-500">
          {detailQuery.error instanceof Error ? detailQuery.error.message : "Account tidak ditemukan atau di luar akses Anda."}
        </p>
        <Link href="/dashboard/sales-funnel/accounts" className="mt-3 inline-block text-sm font-semibold text-pink-600 hover:underline">
          ← Kembali ke Accounts
        </Link>
      </div>
    );
  }

  const { account, contacts, leads, deals, quotations, invoices, tasks } = detail;
  const openDeals = deals.filter((d) => !d.closed_at);
  const wonValue = deals.filter((d) => d.is_won).reduce((acc, d) => acc + Number(d.value_final ?? d.value_estimate ?? 0), 0);
  const openTasks = tasks.filter((t) => t.status === "open" || t.status === "in_progress");

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200/70 pb-4">
        <Link href="/dashboard/sales-funnel/accounts" className="mb-2 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-pink-600">
          <ArrowLeft className="h-4 w-4" /> Accounts
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
              <Building2 className="h-6 w-6 text-pink-500" /> {account.name}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge className="border-0 bg-gray-100 font-normal text-gray-600">{ORG_TYPE_LABELS[account.account_type]}</Badge>
              {account.industry ? <Badge className="border-0 bg-violet-100 font-normal text-violet-700">{account.industry}</Badge> : null}
              <span className="text-xs text-gray-500">
                {account.city ?? ""}
                {account.branch_name ? ` · ${account.branch_name}` : ""}
                {account.owner_name ? ` · PJ: ${account.owner_name}` : ""}
              </span>
            </div>
            <p className="mt-2 text-sm text-gray-600">
              {account.phone ? <span className="font-mono">{account.phone}</span> : null}
              {account.email ? <span>{account.phone ? " · " : ""}{account.email}</span> : null}
              {account.website ? (
                <span>
                  {account.phone || account.email ? " · " : ""}
                  <a href={account.website.startsWith("http") ? account.website : `https://${account.website}`} target="_blank" rel="noopener noreferrer" className="text-pink-600 hover:underline">
                    {account.website}
                  </a>
                </span>
              ) : null}
              {account.address ? <span className="block text-xs text-gray-500">{account.address}</span> : null}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button type="button" variant="outline" onClick={() => setTaskOpen(true)} className="h-9 gap-1.5 rounded-lg">
              <CalendarPlus className="h-3.5 w-3.5" /> Task
            </Button>
            <Button type="button" variant="outline" onClick={() => setEditOpen(true)} className="h-9 gap-1.5 rounded-lg">
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
            <Button type="button" variant="outline" onClick={() => setDeleteOpen(true)} className="h-9 gap-1.5 rounded-lg border-red-200 text-red-600 hover:bg-red-50">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Contact", contacts.length],
          ["Lead", leads.length],
          ["Deal Terbuka", openDeals.length],
          ["Nilai Menang", formatRupiah(wonValue)],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border border-gray-200/80 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
            <p className="mt-1 text-xl font-bold text-gray-900">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* ── Contacts ── */}
          <section>
            <div className="mb-2.5 flex items-center justify-between">
              <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                <Users className="h-4 w-4 text-pink-500" /> Contacts
              </p>
              <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => { setEditingContact(null); setContactFormOpen(true); }}>
                <Plus className="h-3.5 w-3.5" /> Contact
              </Button>
            </div>
            {contacts.length === 0 ? (
              <p className="rounded-xl border border-dashed border-gray-300 py-6 text-center text-sm text-gray-400">Belum ada contact.</p>
            ) : (
              <ul className="divide-y divide-gray-200/60 rounded-xl border border-gray-200/80 bg-white">
                {contacts.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
                    <div className="min-w-0 flex-1">
                      <span className="font-medium text-gray-900">{c.name}</span>
                      {c.is_primary ? <Badge className="ml-1.5 border-0 bg-pink-100 font-normal text-pink-700">utama</Badge> : null}
                      {c.title ? <span className="ml-1.5 text-xs text-gray-500">{c.title}</span> : null}
                      <p className="text-xs text-gray-500">
                        <span className="font-mono">{c.phone}</span>
                        <a href={`https://wa.me/${c.phone}`} target="_blank" rel="noopener noreferrer" className="ml-1.5 inline-flex align-middle text-emerald-600" title="Chat WA">
                          <MessageCircle className="h-3.5 w-3.5" />
                        </a>
                        {c.email ? ` · ${c.email}` : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="text-xs text-gray-500 hover:text-pink-700"
                      onClick={() => {
                        setEditingContact(contactToSalesContact(c, account.id, account.company_id, account.branch_id, account.name));
                        setContactFormOpen(true);
                      }}
                    >
                      Edit
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── Leads & Deals ── */}
          <section>
            <p className="mb-2.5 text-sm font-semibold text-gray-900">Leads</p>
            {leads.length === 0 ? (
              <p className="rounded-xl border border-dashed border-gray-300 py-6 text-center text-sm text-gray-400">Belum ada lead untuk account ini.</p>
            ) : (
              <ul className="divide-y divide-gray-200/60 rounded-xl border border-gray-200/80 bg-white">
                {leads.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
                    <Link href={`/dashboard/sales-funnel/leads/${l.id}`} className="min-w-0 flex-1 font-medium text-gray-900 hover:text-pink-700 hover:underline">
                      {l.org_name} <span className="text-xs font-normal text-gray-500">· PIC {l.pic_name}</span>
                    </Link>
                    <Badge className="border-0 bg-orange-100 font-normal text-orange-700">{TEMPERATURE_LABELS[l.temperature as LeadTemperature] ?? l.temperature}</Badge>
                    <Badge className="border-0 bg-blue-100 font-normal text-blue-700">{STATUS_LABELS[l.status as LeadStatus] ?? l.status}</Badge>
                    <span className="text-xs text-gray-400">{formatDate(l.created_at, "—")}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <p className="mb-2.5 text-sm font-semibold text-gray-900">Deals</p>
            {deals.length === 0 ? (
              <p className="rounded-xl border border-dashed border-gray-300 py-6 text-center text-sm text-gray-400">Belum ada deal.</p>
            ) : (
              <ul className="divide-y divide-gray-200/60 rounded-xl border border-gray-200/80 bg-white">
                {deals.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
                    <Link href={`/dashboard/sales-funnel/pipeline?deal=${d.id}`} className="min-w-0 flex-1 font-medium text-gray-900 hover:text-pink-700 hover:underline">
                      {d.title}
                    </Link>
                    <Badge className={`border-0 font-normal ${d.is_won ? "bg-emerald-100 text-emerald-700" : d.is_lost ? "bg-gray-100 text-gray-500" : "bg-pink-100 text-pink-700"}`}>{d.stage_name}</Badge>
                    <span className="text-xs text-gray-600">{formatRupiah(d.value_final ?? d.value_estimate)}</span>
                    <span className="text-xs text-gray-400">{formatDate(d.event_date, "—")}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {(quotations.length > 0 || invoices.length > 0) && (
            <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-2 text-sm font-semibold text-gray-900">Quotation</p>
                <ul className="space-y-1 text-xs">
                  {quotations.map((q) => (
                    <li key={q.id} className="flex justify-between rounded-lg border border-gray-200/80 bg-white px-3 py-2">
                      <span>{q.quote_number} <Badge className="ml-1 border-0 bg-gray-100 font-normal text-gray-600">{q.status}</Badge></span>
                      <span className="font-medium">{formatRupiah(q.total)}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-2 text-sm font-semibold text-gray-900">Invoice</p>
                <ul className="space-y-1 text-xs">
                  {invoices.map((i) => (
                    <li key={i.id} className="flex justify-between rounded-lg border border-gray-200/80 bg-white px-3 py-2">
                      <span>{i.invoice_number} <Badge className="ml-1 border-0 bg-gray-100 font-normal text-gray-600">{i.status}</Badge></span>
                      <span className="font-medium">{formatRupiah(i.amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          {/* ── Timeline terpadu ── */}
          <section>
            <p className="mb-2.5 inline-flex items-center gap-1.5 text-sm font-semibold text-gray-900">
              <CalendarDays className="h-4 w-4 text-pink-500" /> Timeline
            </p>
            <RecordTimeline
              subjectType="account"
              subjectId={accountId}
              onCompleteTask={(taskId) => completeTask.mutate({ id: taskId, values: { status: "done" } })}
              emptyText="Belum ada aktivitas untuk account ini."
            />
          </section>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200/80 bg-white p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Task terbuka ({openTasks.length})</p>
            {openTasks.length === 0 ? (
              <p className="text-sm text-gray-400">Tidak ada task terbuka.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {openTasks.slice(0, 8).map((t) => (
                  <li key={t.id} className="rounded-lg border border-gray-200/80 p-2">
                    <p className="font-medium text-gray-900">{t.title ?? t.activity_type}</p>
                    <p className="text-xs text-gray-500">
                      {formatDateTime(t.due_at, "tanpa jatuh tempo")}
                      {t.owner_name ? ` · ${t.owner_name}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/dashboard/sales-funnel/tasks" className="mt-2 inline-block text-xs font-semibold text-pink-600 hover:underline">
              Buka Tasks & Kalender →
            </Link>
          </div>
          {account.notes ? (
            <div className="rounded-xl bg-amber-50/70 p-4 text-sm text-amber-900">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-600">Catatan</p>
              <p className="whitespace-pre-wrap">{account.notes}</p>
            </div>
          ) : null}
          {account.npwp ? (
            <div className="rounded-xl border border-gray-200/80 bg-white p-4 text-sm">
              <p className="text-xs uppercase tracking-wide text-gray-500">NPWP</p>
              <p className="mt-1 font-mono text-gray-900">{account.npwp}</p>
            </div>
          ) : null}
        </div>
      </div>

      <AccountFormDialog open={editOpen} onOpenChange={setEditOpen} account={account} />
      <ContactFormDialog
        open={contactFormOpen}
        onOpenChange={(open) => {
          setContactFormOpen(open);
          if (!open) setEditingContact(null);
        }}
        contact={editingContact}
        defaultAccountId={account.id}
      />
      <TaskFormDialog
        open={taskOpen}
        onOpenChange={setTaskOpen}
        subject={{ subject_type: "account", subject_id: account.id, label: account.name }}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Hapus account?"
        description="Contact-nya dilepas (tidak ikut terhapus). Account yang masih punya lead aktif tidak bisa dihapus."
        confirmLabel="Hapus"
        variant="danger"
        onConfirm={() => {
          deleteMutation.mutate(account.id);
          setDeleteOpen(false);
        }}
      />
    </div>
  );
}

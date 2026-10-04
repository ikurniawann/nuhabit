"use client";

import { formatDate, formatRupiah } from "@/lib/format";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CalendarDays,
  Loader2,
  MessageCircle,
  Pencil,
  Plus,
  TrendingUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DealFormDialog } from "../../pipeline";
import { formatRupiahOrDash } from "../../pipeline/types";
import { useLeadDetail, usePicLookup } from "../queries";
import {
  ORG_TYPE_LABELS,
  SOURCE_LABELS,
  STATUS_LABELS,
  TEMPERATURE_LABELS,
  type LeadDealSummary,
  type SalesLead,
} from "../types";
import { LeadFormDialog } from "./lead-form-dialog";
import { MemberLoyaltyCard } from "./member-loyalty-card";
import { RecordTimeline } from "@/features/sales-funnel/timeline";
import { ScoreBadge } from "./score-badge";
import { useUpdateTask } from "@/features/sales-funnel/tasks/queries";
import { TaskFormDialog } from "@/features/sales-funnel/tasks/components/task-form-dialog";

function DealRow({ deal }: { deal: LeadDealSummary }) {
  const stageBadge = deal.is_won
    ? "border-0 bg-emerald-100 font-normal text-emerald-700"
    : deal.is_lost
      ? "border-0 bg-red-100 font-normal text-red-700"
      : "border-0 bg-blue-100 font-normal text-blue-700";
  return (
    <li className="flex flex-col gap-1 rounded-xl border border-gray-200/80 bg-white p-3.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="font-medium text-gray-900">{deal.title}</p>
        <p className="mt-0.5 text-xs text-gray-500">
          {formatDate(deal.event_date, "—")}
          {deal.event_date && !deal.is_event_date_fixed ? " (tentatif)" : ""}
          {deal.pax_estimate ? ` · ${deal.pax_estimate} pax` : ""}
          {deal.lost_reason_name ? ` · Kalah: ${deal.lost_reason_name}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        <span className="text-sm font-semibold text-gray-900">
          {formatRupiahOrDash(deal.value_final ?? deal.value_estimate)}
        </span>
        <Badge className={stageBadge}>{deal.stage_name}</Badge>
      </div>
    </li>
  );
}

export function LeadDetailPage({ leadId }: { leadId: string }) {
  const [editOpen, setEditOpen] = useState(false);
  const [dealFormOpen, setDealFormOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);

  const detailQuery = useLeadDetail(leadId);
  const completeTask = useUpdateTask();
  const detail = detailQuery.data;
  // Instansi lain yang dibawa PIC yang sama (satu PIC bisa banyak leads)
  const picLookup = usePicLookup(detail?.lead.pic_phone ?? "");
  const otherLeads = (picLookup.data?.leads ?? []).filter(
    (other) => other.id !== leadId
  );

  if (detailQuery.isLoading) {
    return (
      <div className="py-24 text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" />
        <p className="mt-2 text-sm text-gray-500">Memuat profil instansi...</p>
      </div>
    );
  }
  if (detailQuery.isError) {
    return (
      <div className="py-24 text-center">
        <p className="text-gray-500">
          {detailQuery.error instanceof Error
            ? detailQuery.error.message
            : "Gagal memuat profil instansi"}
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() => detailQuery.refetch()}
          className="mt-3 h-9 rounded-lg"
        >
          Coba Lagi
        </Button>
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="py-24 text-center">
        <p className="text-gray-500">Instansi tidak ditemukan atau di luar akses Anda.</p>
        <Link
          href="/dashboard/sales-funnel/leads"
          className="mt-3 inline-block text-sm font-semibold text-pink-600 hover:underline"
        >
          ← Kembali ke Leads
        </Link>
      </div>
    );
  }

  const { lead, deals, customer, recent_orders } = detail;
  const wonDeals = deals.filter((d) => d.is_won);
  const openDeals = deals.filter((d) => !d.closed_at);
  const totalWonValue = wonDeals.reduce(
    (acc, d) => acc + Number(d.value_final ?? d.value_estimate ?? 0),
    0
  );

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="border-b border-gray-200/70 pb-4">
        <Link
          href="/dashboard/sales-funnel/leads"
          className="mb-2 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-pink-600"
        >
          <ArrowLeft className="h-4 w-4" /> Leads
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{lead.org_name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge className="border-0 bg-gray-100 font-normal text-gray-600">
                {ORG_TYPE_LABELS[lead.org_type]}
              </Badge>
              <Badge className="border-0 bg-orange-100 font-normal text-orange-700">
                {TEMPERATURE_LABELS[lead.temperature]}
              </Badge>
              <Badge className="border-0 bg-blue-100 font-normal text-blue-700">
                {STATUS_LABELS[lead.status]}
              </Badge>
              <ScoreBadge score={lead.score ?? 0} />
              <span className="text-xs text-gray-500">
                Sumber: {SOURCE_LABELS[lead.source]}
                {lead.city ? ` · ${lead.city}` : ""}
                {lead.branch_name ? ` · ${lead.branch_name}` : ""}
              </span>
            </div>
            <p className="mt-2 text-sm text-gray-600">
              PIC: <span className="font-medium">{lead.pic_name}</span>
              {lead.pic_title ? ` (${lead.pic_title})` : ""} ·{" "}
              <span className="font-mono">{lead.pic_phone}</span>
              <a
                href={`https://wa.me/${lead.pic_phone}`}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-1.5 inline-flex align-middle text-emerald-600 hover:text-emerald-700"
                title="Chat WA PIC"
              >
                <MessageCircle className="h-4 w-4" />
              </a>
              {lead.owner_name ? (
                <span className="text-gray-500"> · PJ: {lead.owner_name}</span>
              ) : null}
            </p>
            {lead.account_id ? (
              <p className="mt-1 text-xs text-gray-500">
                Account:{" "}
                <Link
                  href={`/dashboard/sales-funnel/accounts/${lead.account_id}`}
                  className="font-medium text-pink-600 hover:underline"
                >
                  {lead.account_name ?? lead.org_name}
                </Link>
              </p>
            ) : null}
            {otherLeads.length > 0 ? (
              <p className="mt-1 text-xs text-gray-500">
                PIC ini juga membawa:{" "}
                {otherLeads.map((other, index) => (
                  <span key={other.id}>
                    {index > 0 ? ", " : ""}
                    <Link
                      href={`/dashboard/sales-funnel/leads/${other.id}`}
                      className="font-medium text-pink-600 hover:underline"
                    >
                      {other.org_name}
                    </Link>
                  </span>
                ))}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setTaskOpen(true)}
              className="h-9 gap-1.5 rounded-lg"
            >
              <CalendarDays className="h-3.5 w-3.5" /> Task
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditOpen(true)}
              className="h-9 gap-1.5 rounded-lg"
            >
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
            <Button
              type="button"
              onClick={() => setDealFormOpen(true)}
              className="h-9 gap-1.5 rounded-lg bg-pink-600 text-white hover:bg-pink-700"
            >
              <Plus className="h-4 w-4" /> Buat Deal
            </Button>
          </div>
        </div>
      </div>

      {/* ── Statistik riwayat ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Total Deal", value: String(deals.length) },
          { label: "Berjalan", value: String(openDeals.length) },
          {
            label: "Menang (Booked)",
            value: `${wonDeals.length}×`,
            accent: wonDeals.length > 1 ? "repeat order 🎉" : undefined,
          },
          { label: "Nilai Menang Total", value: formatRupiah(totalWonValue) },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-2xl border border-gray-200/70 bg-white p-4"
          >
            <p className="text-xs text-gray-400">{stat.label}</p>
            <p className="mt-1 text-lg font-bold text-gray-900">{stat.value}</p>
            {stat.accent ? (
              <p className="text-xs font-medium text-emerald-600">{stat.accent}</p>
            ) : null}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* ── Riwayat deal ── */}
        <div className="lg:col-span-2">
          <p className="mb-2.5 inline-flex items-center gap-1.5 text-sm font-semibold text-gray-900">
            <TrendingUp className="h-4 w-4 text-pink-500" /> Riwayat Deal & Acara
          </p>
          {deals.length === 0 ? (
            <p className="rounded-xl border border-dashed border-gray-300 py-8 text-center text-sm text-gray-400">
              Belum ada deal — mulai dari tombol &quot;Buat Deal&quot;.
            </p>
          ) : (
            <ul className="space-y-2">
              {deals.map((deal) => (
                <DealRow key={deal.id} deal={deal} />
              ))}
            </ul>
          )}

          {/* ── Timeline terpadu (EPIC-050 T-1.4): task, tahap deal, quotation, invoice, WA ── */}
          <p className="mb-2.5 mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-gray-900">
            <CalendarDays className="h-4 w-4 text-pink-500" /> Timeline
          </p>
          <RecordTimeline
            subjectType="lead"
            subjectId={leadId}
            onCompleteTask={(taskId) => completeTask.mutate({ id: taskId, values: { status: "done" } })}
            emptyText="Belum ada aktivitas tercatat."
          />

          {lead.notes ? (
            <div className="mt-6 rounded-xl bg-amber-50/70 p-4 text-sm text-amber-900">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-600">
                Catatan Lead
              </p>
              <p className="whitespace-pre-wrap">{lead.notes}</p>
            </div>
          ) : null}
        </div>

        {/* ── Member loyalty ── */}
        <div>
          {/* EPIC-050 T-5.2 — asal lead dari tautan iklan / form publik. */}
          {lead.utm_source || lead.utm_campaign || lead.landing_page || lead.referrer ? (
            <div className="mb-4 rounded-xl border border-gray-200/80 bg-white p-4 text-sm">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Asal Lead</p>
              <dl className="space-y-1 text-gray-700">
                {([
                  ["Sumber (utm_source)", lead.utm_source],
                  ["Media (utm_medium)", lead.utm_medium],
                  ["Kampanye (utm_campaign)", lead.utm_campaign],
                  ["Konten (utm_content)", lead.utm_content],
                  ["Kata kunci (utm_term)", lead.utm_term],
                ] as Array<[string, string | null | undefined]>)
                  .filter(([, v]) => Boolean(v))
                  .map(([label, v]) => (
                    <div key={label} className="flex justify-between gap-3">
                      <dt className="text-gray-500">{label}</dt>
                      <dd className="font-medium">{v}</dd>
                    </div>
                  ))}
              </dl>
              {lead.landing_page ? (
                <p className="mt-2 break-all text-xs text-gray-500">Halaman masuk: {lead.landing_page}</p>
              ) : null}
              {lead.referrer ? (
                <p className="mt-1 break-all text-xs text-gray-500">Referrer: {lead.referrer}</p>
              ) : null}
            </div>
          ) : null}
          {lead.score_breakdown && lead.score_breakdown.length > 0 ? (
            <div className="mb-4 rounded-xl border border-gray-200/80 bg-white p-4 text-sm">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Rincian skor ({lead.score ?? 0})
              </p>
              <ul className="space-y-1">
                {lead.score_breakdown.map((item) => (
                  <li key={item.rule_id} className="flex justify-between text-gray-700">
                    <span>
                      {item.name}
                      {item.count && item.count > 1 ? ` ×${item.count}` : ""}
                    </span>
                    <span className={item.points >= 0 ? "font-medium text-emerald-700" : "font-medium text-red-600"}>
                      {item.points >= 0 ? "+" : ""}{item.points}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <MemberLoyaltyCard
            lead={lead as SalesLead}
            customer={customer}
            recentOrders={recent_orders}
          />
        </div>
      </div>

      <LeadFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        lead={lead as SalesLead}
      />
      <DealFormDialog
        open={dealFormOpen}
        onOpenChange={setDealFormOpen}
        deal={null}
        initialLead={lead as SalesLead}
      />
      <TaskFormDialog
        open={taskOpen}
        onOpenChange={setTaskOpen}
        subject={{ subject_type: "lead", subject_id: leadId, label: lead.org_name }}
      />
    </div>
  );
}

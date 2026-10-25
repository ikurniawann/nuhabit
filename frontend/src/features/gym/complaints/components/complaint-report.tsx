"use client";

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Clock, MessageSquareWarning, RotateCcw, Siren } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatCard } from "@/components/ui/stat-card";
import { Field, TableNote } from "@/features/crm/engagement/components/shared";
import type { ReportColumn } from "@/features/gym/reports/csv";
import { ReportTable } from "@/features/gym/reports/components/report-table";
import { presetRange, wibToday } from "@/features/gym/reports/params";
import { SELECT } from "@/features/gym/shared";
import { formatNumber } from "@/lib/format";
import { COMPLAINT_KEYS, SOURCE_LABEL, complaintsApi, hoursText, rateText, type CoachMetrics, type ComplaintSource, type Metrics } from "../api";

/** Kolom bersama tiap kelompok laporan; CSV memakai angka mentah (jam, rasio). */
export function metricColumns<T extends Metrics>(groupLabel: string, label: (row: T) => string = (r) => r.label): ReportColumn<T>[] {
  return [
    { label: groupLabel, value: label },
    { label: "Tiket", value: (r) => r.total, render: (r) => formatNumber(r.total), numeric: true },
    { label: "Terbuka", value: (r) => r.open, render: (r) => formatNumber(r.open), numeric: true },
    { label: "Selesai", value: (r) => r.resolved, render: (r) => formatNumber(r.resolved), numeric: true },
    { label: "Dibuka lagi", value: (r) => r.reopened, render: (r) => formatNumber(r.reopened), numeric: true },
    { label: "Tingkat dibuka lagi", value: (r) => r.reopened_rate, render: (r) => rateText(r.reopened_rate), numeric: true },
    { label: "Median respons (jam)", value: (r) => r.respond_median_h, render: (r) => hoursText(r.respond_median_h), numeric: true },
    { label: "Median selesai (jam)", value: (r) => r.resolve_median_h, render: (r) => hoursText(r.resolve_median_h), numeric: true },
    { label: "P90 selesai (jam)", value: (r) => r.resolve_p90_h, render: (r) => hoursText(r.resolve_p90_h), numeric: true },
    { label: "Dieskalasi", value: (r) => r.escalated, render: (r) => formatNumber(r.escalated), numeric: true },
  ];
}

const coachColumns: ReportColumn<CoachMetrics>[] = [
  ...metricColumns<CoachMetrics>("Coach"),
  { label: "Peserta hadir", value: (r) => r.attendees, render: (r) => formatNumber(r.attendees), numeric: true },
  {
    label: "Keluhan per 100 peserta",
    value: (r) => r.rate_per_100,
    render: (r) => (r.rate_per_100 === null ? "-" : r.rate_per_100.toLocaleString("id-ID")),
    numeric: true,
  },
];

/** Laporan keluhan: ringkasan, per kategori, coach, sumber, dan cabang, dengan unduhan CSV per tabel. */
export function ComplaintReport() {
  const [range, setRange] = useState(() => presetRange("this_month", wibToday()));
  const [branch, setBranch] = useState("");
  const options = useQuery({ queryKey: COMPLAINT_KEYS.options, queryFn: complaintsApi.options });
  const query = new URLSearchParams({ from: range.from, to: range.to, ...(branch ? { branch_id: branch } : {}) }).toString();
  const report = useQuery({ queryKey: COMPLAINT_KEYS.report(query), queryFn: () => complaintsApi.report(query), placeholderData: keepPreviousData });
  const r = report.data;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Dari">
            <Input type="date" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} />
          </Field>
          <Field label="Sampai">
            <Input type="date" value={range.to} min={range.from} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} />
          </Field>
          <Field label="Cabang">
            <select className={SELECT} value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="">Semua cabang</option>
              {options.data?.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Card>
      {report.isLoading ? (
        <TableNote>Memuat laporan…</TableNote>
      ) : report.error ? (
        <TableNote tone="danger">{report.error.message}</TableNote>
      ) : r ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Tiket masuk" value={formatNumber(r.summary.total)} hint={`${formatNumber(r.summary.open)} masih terbuka`} icon={<MessageSquareWarning />} tone="ink" />
            <StatCard
              label="Median waktu selesai"
              value={hoursText(r.summary.resolve_median_h)}
              hint={`P90 ${hoursText(r.summary.resolve_p90_h)}`}
              icon={<Clock />}
            />
            <StatCard label="Tingkat dibuka lagi" value={rateText(r.summary.reopened_rate)} hint={`${formatNumber(r.summary.reopened)} tiket`} icon={<RotateCcw />} tone="warning" />
            <StatCard label="Dieskalasi" value={formatNumber(r.summary.escalated)} icon={<Siren />} tone="danger" />
          </div>
          <ReportTable title="Per kategori" rows={r.by_category} columns={metricColumns("Kategori")} rowKey={(x) => x.key} csvName="keluhan-kategori" period={r} />
          <ReportTable
            title="Per coach"
            description="Keluhan yang tertaut ke coach per 100 peserta hadir di kelasnya, sama dengan KPI coach."
            rows={r.by_coach}
            columns={coachColumns}
            rowKey={(x) => x.key}
            csvName="keluhan-coach"
            period={r}
          />
          <ReportTable
            title="Per sumber"
            rows={r.by_source}
            columns={metricColumns("Sumber", (x) => SOURCE_LABEL[x.key as ComplaintSource] ?? x.key)}
            rowKey={(x) => x.key}
            csvName="keluhan-sumber"
            period={r}
          />
          <ReportTable title="Per cabang" rows={r.by_branch} columns={metricColumns("Cabang")} rowKey={(x) => x.key || "none"} csvName="keluhan-cabang" period={r} />
        </>
      ) : null}
    </div>
  );
}

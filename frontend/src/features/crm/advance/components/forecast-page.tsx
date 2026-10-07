"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChartBarIcon } from "@heroicons/react/24/outline";
import { ChevronLeft, ChevronRight, Loader2, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { usePipelines } from "@/features/sales-funnel/pipeline/queries";
import { FORECAST_CATEGORY_LABELS } from "@/lib/sales-funnel/forecast";
import { useForecast, useSaveTargets, useTargets } from "../queries";
import type { ForecastRow } from "../types";
import { formatRupiah } from "@/lib/format";

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const shiftMonth = (m: string, dir: -1 | 1) => {
  const [y, mo] = m.split("-").map(Number);
  return monthKey(new Date(y, mo - 1 + dir, 1));
};
const monthLabel = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString("id-ID", { month: "long", year: "numeric" });
};

const CATEGORY_BADGE: Record<string, string> = {
  commit: "border-0 bg-emerald-100 font-normal text-emerald-700",
  best_case: "border-0 bg-amber-100 font-normal text-amber-700",
  pipeline: "border-0 bg-gray-100 font-normal text-gray-600",
  closed_won: "border-0 bg-emerald-600 font-semibold text-white",
  closed_lost: "border-0 bg-red-100 font-normal text-red-700",
};

/** EPIC-050 T-3.2 — Forecast & Target per salesperson per bulan. */
export function ForecastPage() {
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [pipelineId, setPipelineId] = useState("");
  const [editTargets, setEditTargets] = useState<Record<string, string> | null>(null);
  const [editCompany, setEditCompany] = useState("");
  const forecastQuery = useForecast(month, pipelineId);
  const targetsQuery = useTargets(month);
  const pipelinesQuery = usePipelines();
  const saveMutation = useSaveTargets();
  const data = forecastQuery.data;
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const total = data?.total;
  const companyTarget = data?.company_target ?? null;
  const allocated = total?.allocated_target_value ?? 0;
  const allocationPct = companyTarget && companyTarget.target_value > 0 ? Math.round((allocated / companyTarget.target_value) * 1000) / 10 : null;

  const startEdit = () => {
    const map: Record<string, string> = {};
    for (const r of rows) if (r.user_id && r.user_id !== "total") map[r.user_id] = r.target_value ? String(r.target_value) : "";
    setEditTargets(map);
    setEditCompany(companyTarget?.target_value ? String(companyTarget.target_value) : "");
  };
  const saveEdit = () => {
    if (!editTargets) return;
    const targets: Array<{ user_id: string | null; period_month: string; target_value: number }> = Object.entries(editTargets)
      .filter(([, v]) => v !== "")
      .map(([user_id, v]) => ({ user_id, period_month: month, target_value: Number(v) || 0 }));
    if (editCompany !== "" || companyTarget) targets.push({ user_id: null, period_month: month, target_value: Number(editCompany) || 0 });
    if (targets.length === 0) { setEditTargets(null); return; }
    saveMutation.mutate(targets, { onSuccess: () => setEditTargets(null) });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Forecast & Target</h1>
          <p className="mt-1 text-sm text-gray-500">
            Target per salesperson per bulan vs deal menang + pipeline tertimbang (nilai × probability tahap). Commit ≥ 75%, Best case ≥ 50%.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" className="h-9 w-9 p-0" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Bulan sebelumnya"><ChevronLeft className="h-4 w-4" /></Button>
          <span className="min-w-36 text-center text-sm font-semibold text-gray-900">{monthLabel(month)}</span>
          <Button type="button" variant="outline" size="sm" className="h-9 w-9 p-0" onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label="Bulan berikutnya"><ChevronRight className="h-4 w-4" /></Button>
          <Select value={pipelineId || "all"} onValueChange={(v) => setPipelineId(v === "all" ? "" : v)}>
            <SelectTrigger className="h-9 w-48 bg-white"><SelectValue placeholder="Pipeline" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua pipeline</SelectItem>
              {(pipelinesQuery.data ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {total ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            [total.company_target_set ? "Target perusahaan" : "Target (Σ salesperson)", formatRupiah(total.target_value)],
            ["Menang", `${formatRupiah(total.won_value)} · ${total.won_deals} deal`],
            ["Weighted pipeline", formatRupiah(total.weighted_value)],
            ["Proyeksi", `${formatRupiah(total.won_value + total.weighted_value)} (${total.attainment_percent}%)`],
            ["Gap ke target", formatRupiah(total.gap)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-gray-200/80 bg-white p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
              <p className="mt-1 text-lg font-bold text-gray-900">{value}</p>
            </div>
          ))}
        </div>
      ) : null}

      {total?.company_target_set && allocationPct !== null ? (
        <p className={`text-sm ${allocationPct < 100 ? "text-amber-700" : allocationPct > 100 ? "text-red-700" : "text-emerald-700"}`}>
          Teralokasi ke salesperson: {formatRupiah(allocated)} ({allocationPct}% dari target perusahaan)
          {allocationPct < 100 ? ` · sisa ${formatRupiah(companyTarget!.target_value - allocated)} belum dibagi` : allocationPct > 100 ? " · melebihi target perusahaan" : ""}
        </p>
      ) : null}

      <PurchasingListSection
        icon={ChartBarIcon}
        title="Per Salesperson"
        description="Attainment = (menang + weighted) ÷ target."
        toolbar={
          editTargets ? (
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-gray-600">
                Target perusahaan
                <Input type="number" min={0} value={editCompany} onChange={(e) => setEditCompany(e.target.value)} placeholder="kosong = Σ salesperson" className="h-9 w-44" />
              </label>
              <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => setEditTargets(null)}>Batal</Button>
              <Button type="button" size="sm" className="h-9 gap-1 bg-pink-600 text-white hover:bg-pink-700" onClick={saveEdit} disabled={saveMutation.isPending}>
                <Save className="h-4 w-4" /> Simpan target
              </Button>
            </div>
          ) : (
            <Button type="button" variant="outline" size="sm" className="h-9" onClick={startEdit} disabled={rows.length === 0 || targetsQuery.isLoading}>
              Atur target bulan ini
            </Button>
          )
        }
      >
        {forecastQuery.isLoading ? (
          <div className="py-14 text-center"><Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" /></div>
        ) : rows.length === 0 ? (
          <p className="py-14 text-center text-sm text-gray-500">Belum ada salesperson / deal di bulan ini.</p>
        ) : (
          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200/70 bg-gray-50/80 text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3 text-left font-semibold">Salesperson</th>
                  <th className="px-4 py-3 text-right font-semibold">Target</th>
                  <th className="px-4 py-3 text-right font-semibold">Menang</th>
                  <th className="px-4 py-3 text-right font-semibold">Commit</th>
                  <th className="px-4 py-3 text-right font-semibold">Best case</th>
                  <th className="px-4 py-3 text-right font-semibold">Pipeline</th>
                  <th className="px-4 py-3 text-right font-semibold">Weighted</th>
                  <th className="px-4 py-3 text-left font-semibold">Attainment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200/50">
                {rows.map((r) => <ForecastRowView key={r.user_id ?? "none"} row={r} edit={editTargets} onEdit={(v) => editTargets && r.user_id && setEditTargets({ ...editTargets, [r.user_id]: v })} />)}
                {total ? (
                  <tr className="bg-gray-50/80 font-semibold">
                    <td className="px-4 py-3">Total{total.company_target_set ? <span className="ml-1 text-xs font-normal text-gray-500">(target perusahaan)</span> : null}</td>
                    <td className="px-4 py-3 text-right">{formatRupiah(total.target_value)}</td>
                    <td className="px-4 py-3 text-right text-emerald-700">{formatRupiah(total.won_value)}</td>
                    <td className="px-4 py-3 text-right">{formatRupiah(total.commit_value)}</td>
                    <td className="px-4 py-3 text-right">{formatRupiah(total.best_case_value)}</td>
                    <td className="px-4 py-3 text-right">{formatRupiah(total.pipeline_value)}</td>
                    <td className="px-4 py-3 text-right">{formatRupiah(total.weighted_value)}</td>
                    <td className="px-4 py-3">{total.attainment_percent}%</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </PurchasingListSection>

      {data && data.deals.length > 0 ? (
        <PurchasingListSection icon={ChartBarIcon} title="Deal di periode ini" description="Menang = ditutup bulan ini; terbuka = tanggal acara (atau dibuat) bulan ini.">
          <ul className="divide-y divide-gray-200/60">
            {data.deals.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 px-5 py-2.5 text-sm">
                <Link href={`/dashboard/sales-funnel/pipeline?deal=${d.id}`} className="min-w-0 flex-1 font-medium text-gray-900 hover:text-pink-700 hover:underline">
                  {d.title} <span className="text-xs font-normal text-gray-500">· {d.org_name}</span>
                </Link>
                <Badge className={CATEGORY_BADGE[d.category] ?? ""}>{FORECAST_CATEGORY_LABELS[d.category]}</Badge>
                <span className="text-xs text-gray-500">{d.stage_name} · {d.probability}%</span>
                <span className="w-32 text-right font-medium">{formatRupiah(d.value)}</span>
                <span className="w-28 text-right text-xs text-gray-500">{d.owner_name ?? "Tanpa PJ"}</span>
              </li>
            ))}
          </ul>
        </PurchasingListSection>
      ) : null}
    </div>
  );
}

function ForecastRowView({ row, edit, onEdit }: { row: ForecastRow; edit: Record<string, string> | null; onEdit: (v: string) => void }) {
  const pct = Math.min(100, row.attainment_percent);
  return (
    <tr className="hover:bg-gray-50/80">
      <td className="px-4 py-3 font-medium text-gray-900">{row.user_name}<span className="ml-1 text-xs font-normal text-gray-400">{row.open_deals} terbuka</span></td>
      <td className="px-4 py-3 text-right">
        {edit && row.user_id ? (
          <Input type="number" min={0} value={edit[row.user_id] ?? ""} onChange={(e) => onEdit(e.target.value)} className="ml-auto h-8 w-36 text-right" />
        ) : formatRupiah(row.target_value)}
      </td>
      <td className="px-4 py-3 text-right text-emerald-700">{formatRupiah(row.won_value)}</td>
      <td className="px-4 py-3 text-right">{formatRupiah(row.commit_value)}</td>
      <td className="px-4 py-3 text-right">{formatRupiah(row.best_case_value)}</td>
      <td className="px-4 py-3 text-right">{formatRupiah(row.pipeline_value)}</td>
      <td className="px-4 py-3 text-right">{formatRupiah(row.weighted_value)}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="h-2 w-28 overflow-hidden rounded-full bg-gray-100">
            <div className={`h-full ${pct >= 100 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-400" : "bg-pink-500"}`} style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs text-gray-600">{row.target_value > 0 ? `${row.attainment_percent}%` : "—"}</span>
        </div>
      </td>
    </tr>
  );
}

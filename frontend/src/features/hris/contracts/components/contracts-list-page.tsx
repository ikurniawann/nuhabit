"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronUpDownIcon, ChevronUpIcon, ChevronDownIcon } from "@heroicons/react/24/outline";
import { Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { ContractExpiryBanner } from "@/features/users/components/contract-expiry-banner";
import { formatDate, formatNumber } from "@/lib/format";
import type { ContractListItem, KpiRecommendation } from "../api";
import { useContractList, useKpiRecommendation } from "../queries";

/**
 * HRIS → Kontrak: daftar kontrak karyawan lintas karyawan, default menampilkan
 * kontrak AKTIF yang akan segera berakhir (≤30 hari, termasuk yang sudah
 * terlewat). Filter: rentang berakhir, tipe, status, pencarian nama/nomor.
 * Sort: klik judul kolom.
 */

const DAYS_OPTIONS = [
  { value: "30", label: "Berakhir ≤ 30 hari" },
  { value: "7", label: "Berakhir ≤ 7 hari" },
  { value: "14", label: "Berakhir ≤ 14 hari" },
  { value: "60", label: "Berakhir ≤ 60 hari" },
  { value: "90", label: "Berakhir ≤ 90 hari" },
  { value: "all", label: "Semua periode" },
];

const TYPE_OPTIONS = [
  { value: "all", label: "Semua tipe" },
  { value: "pkwt", label: "PKWT (Kontrak)" },
  { value: "pkwtt", label: "PKWTT (Tetap)" },
];

const STATUS_OPTIONS = [
  { value: "active", label: "Aktif" },
  { value: "all", label: "Semua status" },
  { value: "draft", label: "Draft" },
  { value: "ended", label: "Berakhir" },
  { value: "terminated", label: "Diputus" },
  { value: "converted", label: "Konversi" },
];

const STATUS_BADGES: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  active: "bg-green-100 text-green-700",
  ended: "bg-blue-100 text-blue-700",
  terminated: "bg-red-100 text-red-700",
  converted: "bg-purple-100 text-purple-700",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  active: "Aktif",
  ended: "Berakhir",
  terminated: "Diputus",
  converted: "Konversi",
};

type SortKey = "end_date" | "start_date" | "employee_name" | "contract_number";

const SORT_HEADERS: { key: SortKey; label: string }[] = [
  { key: "employee_name", label: "Karyawan" },
  { key: "contract_number", label: "No. Kontrak" },
  { key: "start_date", label: "Mulai" },
  { key: "end_date", label: "Berakhir" },
];

/**
 * Badge rata-rata skor KPI 3 bulan terakhir (EPIC-010 Fase D) — decision
 * support perpanjangan PKWT; keputusan tetap di HRD.
 */
function KpiScoreBadge({
  employeeId,
  recommendation,
}: {
  employeeId: string;
  recommendation: KpiRecommendation | undefined;
}) {
  const entry = recommendation?.[employeeId];
  if (!entry) return <span className="text-gray-400">—</span>;
  const score = entry.avg_score;
  const cls =
    score >= 90
      ? "bg-emerald-100 text-emerald-700"
      : score >= 75
        ? "bg-lime-100 text-lime-700"
        : score >= 60
          ? "bg-amber-100 text-amber-700"
          : "bg-red-100 text-red-700";
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}
      title={`Rata-rata ${entry.periods} periode terakhir${entry.has_final ? " (ada yang final)" : " (draft)"}`}
    >
      {formatNumber(score, 1)}
    </span>
  );
}

function DaysLeftBadge({ item }: { item: ContractListItem }) {
  if (item.days_left === null || item.status !== "active") {
    return <span className="text-gray-400">—</span>;
  }
  const days = item.days_left;
  const cls =
    days < 0 || days <= 14
      ? "bg-red-100 text-red-700"
      : days <= 30
        ? "bg-amber-100 text-amber-700"
        : "bg-gray-100 text-gray-600";
  const label = days < 0 ? `Lewat ${Math.abs(days)} hr` : days === 0 ? "Hari ini" : `${days} hari`;
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {label}
    </span>
  );
}

export function ContractsListPage() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [daysFilter, setDaysFilter] = useState("30");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [sortBy, setSortBy] = useState<SortKey>("end_date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const limit = 15;

  const params = useMemo(
    () => ({
      search: search || undefined,
      days: daysFilter === "all" ? undefined : Number(daysFilter),
      type: typeFilter === "all" ? undefined : typeFilter,
      status: statusFilter,
      sort_by: sortBy,
      sort_order: sortOrder,
      page,
      limit,
    }),
    [search, daysFilter, typeFilter, statusFilter, sortBy, sortOrder, page]
  );

  const { data, isLoading, isError } = useContractList(params);

  const rows = useMemo(() => data?.data ?? [], [data]);
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  // Skor KPI 3 bulan terakhir utk baris yang tampil (rekomendasi PKWT)
  const employeeIds = useMemo(
    () => [...new Set(rows.map((row) => row.employee_id))].sort(),
    [rows]
  );
  const { data: kpiRecommendation } = useKpiRecommendation(employeeIds);

  function applySearch() {
    setSearch(searchInput.trim());
    setPage(1);
  }

  function toggleSort(key: SortKey) {
    if (sortBy === key) {
      setSortOrder((order) => (order === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortOrder("asc");
    }
    setPage(1);
  }

  function sortIcon(key: SortKey) {
    if (sortBy !== key) return <ChevronUpDownIcon className="h-3.5 w-3.5 text-gray-300" />;
    return sortOrder === "asc" ? (
      <ChevronUpIcon className="h-3.5 w-3.5 text-pink-600" />
    ) : (
      <ChevronDownIcon className="h-3.5 w-3.5 text-pink-600" />
    );
  }

  return (
    <div className="space-y-5">
      <div className="border-b border-gray-200/70 pb-4">
        <h1 className="text-2xl font-bold text-gray-900">Kontrak Karyawan</h1>
        <p className="text-sm text-gray-500">
          Pantau kontrak yang akan segera berakhir — {total} kontrak sesuai filter
        </p>
      </div>

      <ContractExpiryBanner />

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Cari nama / no. kontrak..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applySearch()}
            className="h-10 bg-white pl-10 pr-9"
          />
          {searchInput ? (
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              onClick={() => {
                setSearchInput("");
                setSearch("");
                setPage(1);
              }}
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </label>
        <Combobox
          options={DAYS_OPTIONS}
          value={daysFilter}
          onChange={(value) => {
            setDaysFilter(value);
            setPage(1);
          }}
          placeholder="Rentang berakhir"
          className="w-44"
        />
        <Combobox
          options={TYPE_OPTIONS}
          value={typeFilter}
          onChange={(value) => {
            setTypeFilter(value);
            setPage(1);
          }}
          placeholder="Tipe"
          className="w-40"
        />
        <Combobox
          options={STATUS_OPTIONS}
          value={statusFilter}
          onChange={(value) => {
            setStatusFilter(value);
            setPage(1);
          }}
          placeholder="Status"
          className="w-36"
        />
        <Button variant="outline" className="h-10" onClick={applySearch}>
          Terapkan
        </Button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200/70 bg-white shadow-sm">
        {isLoading ? (
          <div className="flex justify-center py-14">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : isError ? (
          <p className="py-14 text-center text-sm text-gray-500">Gagal memuat daftar kontrak</p>
        ) : rows.length === 0 ? (
          <p className="py-14 text-center text-sm text-gray-400">
            Tidak ada kontrak yang cocok dengan filter.
          </p>
        ) : (
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-gray-200/70 bg-gray-50/60 text-left text-xs uppercase tracking-wide text-gray-500">
                {SORT_HEADERS.map((header) => (
                  <th key={header.key} className="px-4 py-3 font-semibold">
                    <button
                      type="button"
                      className="flex items-center gap-1 hover:text-gray-800"
                      onClick={() => toggleSort(header.key)}
                    >
                      {header.label} {sortIcon(header.key)}
                    </button>
                  </th>
                ))}
                <th className="px-4 py-3 font-semibold">Sisa Waktu</th>
                <th className="px-4 py-3 font-semibold">KPI 3 Bln</th>
                <th className="px-4 py-3 font-semibold">Tipe</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Jabatan</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr key={item.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60">
                  <td className="px-4 py-3 font-medium text-gray-900">{item.employee_name}</td>
                  <td className="px-4 py-3 font-mono text-xs">{item.contract_number}</td>
                  <td className="px-4 py-3">{formatDate(item.start_date, "—")}</td>
                  <td className="px-4 py-3">
                    {item.contract_type === "pkwtt" && !item.end_date
                      ? "Tanpa batas"
                      : formatDate(item.end_date, "—")}
                  </td>
                  <td className="px-4 py-3">
                    <DaysLeftBadge item={item} />
                  </td>
                  <td className="px-4 py-3">
                    <KpiScoreBadge
                      employeeId={item.employee_id}
                      recommendation={kpiRecommendation}
                    />
                  </td>
                  <td className="px-4 py-3 uppercase">{item.contract_type}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGES[item.status] ?? ""}`}
                    >
                      {STATUS_LABELS[item.status] ?? item.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{item.position_title ?? "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/dashboard/employees/${item.employee_id}?tab=contracts`}
                      className="text-sm font-medium text-pink-600 hover:text-pink-700 hover:underline"
                    >
                      Kelola
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <p>
            Halaman {page} dari {totalPages} · {total} kontrak
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Sebelumnya
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Berikutnya
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

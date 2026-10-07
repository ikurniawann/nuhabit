"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DocumentMagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { ChevronDown, ChevronRight, Loader2, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { filterComboboxClassName } from "@/components/layout/form-field";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { useCoaList } from "@/features/accounting/chart-of-accounts/queries";
import { useJournalEntryList } from "../queries";
import { JOURNAL_ENTRY_ROUTES } from "../routes";
import type { JournalEntryItem } from "@/lib/accounting/types";
import { formatLedgerAmount } from "@/lib/accounting/format";
import { useDebouncedSearch } from "@/features/accounting/shared/use-debounced-search";

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function JournalHistoryPage() {
  const router = useRouter();
  const {
    query: searchQuery,
    setQuery: setSearchQuery,
    search,
  } = useDebouncedSearch();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [entryType, setEntryType] = useState("");
  const [accountId, setAccountId] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const filters = useMemo(
    () => ({
      status: "POSTED",
      search: search || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      entry_type: entryType || undefined,
      account_id: accountId || undefined,
    }),
    [search, dateFrom, dateTo, entryType, accountId],
  );

  const { data, isLoading } = useJournalEntryList(filters);
  const { data: coaData } = useCoaList({
    is_postable: "true",
    is_active: "true",
  });
  const rows = useMemo(() => data ?? [], [data]);

  const accountOptions = useMemo(
    () =>
      (coaData ?? []).map((a) => ({
        value: a.id,
        label: `${a.code_display || a.code} — ${a.name}`,
      })),
    [coaData],
  );

  const entryTypeOptions = useMemo(
    () => [
      { value: "MANUAL", label: "MANUAL" },
      { value: "OPENING", label: "OPENING" },
    ],
    [],
  );

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() {
    setExpandedIds(new Set(rows.map((r) => r.id)));
  }

  function collapseAll() {
    setExpandedIds(new Set());
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Journal History
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Riwayat jurnal yang sudah POSTED — {rows.length} entri
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push(JOURNAL_ENTRY_ROUTES.list)}
          className="h-10 rounded-lg border-gray-200/80"
        >
          Ke Journal Entries
        </Button>
      </div>

      <PurchasingListSection
        icon={DocumentMagnifyingGlassIcon}
        title="Riwayat Jurnal"
        description="Hanya jurnal POSTED. Klik baris untuk lihat detail akun Debit/Credit."
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-[180px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Cari no / deskripsi..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 bg-card pl-9 pr-9 text-sm focus:border-primary/40 focus:ring-1 focus:ring-primary/30"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  aria-label="Clear"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </label>
            <Combobox
              options={entryTypeOptions}
              value={entryType}
              onChange={setEntryType}
              placeholder="Semua tipe"
              searchPlaceholder="Cari tipe..."
              allowClear
              className={`${filterComboboxClassName} h-10 w-[140px] shrink-0 bg-card`}
            />
            <Combobox
              options={accountOptions}
              value={accountId}
              onChange={setAccountId}
              placeholder="Semua akun"
              searchPlaceholder="Cari COA..."
              allowClear
              className={`${filterComboboxClassName} h-10 min-w-[220px] flex-1 bg-card`}
              contentClassName="min-w-80"
            />
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-10 w-[150px] bg-card text-sm focus:border-primary/40 focus:ring-1 focus:ring-primary/30"
              aria-label="Dari tanggal"
            />
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-10 w-[150px] bg-card text-sm focus:border-primary/40 focus:ring-1 focus:ring-primary/30"
              aria-label="Sampai tanggal"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={expandAll}
              className="h-10 rounded-lg border-gray-200/80"
            >
              Expand
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={collapseAll}
              className="h-10 rounded-lg border-gray-200/80"
            >
              Collapse
            </Button>
          </div>
        }
      >
        {isLoading ? (
          <div className="py-14 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand-text" />
            <p className="mt-2 text-sm text-muted-foreground">
              Memuat journal history...
            </p>
          </div>
        ) : rows.length === 0 ? (
          <div className="py-14 text-center">
            <p className="text-muted-foreground">
              Belum ada jurnal POSTED untuk filter ini
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto px-4">
            <table className="w-full min-w-[960px] text-sm">
              <thead>
                <tr className="border-b border-gray-200/70 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="w-10 px-2 py-3" />
                  <th className="px-3 py-3">No</th>
                  <th className="px-3 py-3">Tanggal</th>
                  <th className="px-3 py-3">Deskripsi</th>
                  <th className="px-3 py-3">Tipe</th>
                  <th className="px-3 py-3">Period</th>
                  <th className="px-3 py-3 text-right">Debit</th>
                  <th className="px-3 py-3 text-right">Credit</th>
                  <th className="px-3 py-3">Posted</th>
                  <th className="px-3 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <HistoryRow
                    key={row.id}
                    row={row}
                    expanded={expandedIds.has(row.id)}
                    onToggle={() => toggleExpand(row.id)}
                    onView={() =>
                      router.push(JOURNAL_ENTRY_ROUTES.edit(row.id))
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PurchasingListSection>
    </div>
  );
}

function HistoryRow({
  row,
  expanded,
  onToggle,
  onView,
}: {
  row: JournalEntryItem;
  expanded: boolean;
  onToggle: () => void;
  onView: () => void;
}) {
  return (
    <>
      <tr className="border-b border-gray-200/70 hover:bg-muted/30">
        <td className="px-2 py-3">
          <button
            type="button"
            onClick={onToggle}
            className="rounded p-0.5 text-muted-foreground hover:bg-muted"
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        </td>
        <td className="px-3 py-3 font-medium tabular-nums text-foreground">
          {row.entry_no}
        </td>
        <td className="px-3 py-3 tabular-nums text-foreground">
          {row.entry_date}
        </td>
        <td className="max-w-[240px] truncate px-3 py-3 text-foreground">
          {row.description || "—"}
        </td>
        <td className="px-3 py-3">
          <Badge variant="outline" className="border-gray-200/80">
            {row.entry_type}
          </Badge>
        </td>
        <td className="px-3 py-3 text-muted-foreground">
          {row.fiscal_period_name || "—"}
          {row.fiscal_year_code ? ` (${row.fiscal_year_code})` : ""}
        </td>
        <td className="px-3 py-3 text-right tabular-nums text-foreground">
          {formatLedgerAmount(row.total_debit)}
        </td>
        <td className="px-3 py-3 text-right tabular-nums text-foreground">
          {formatLedgerAmount(row.total_credit)}
        </td>
        <td className="px-3 py-3 text-xs text-muted-foreground">
          {formatDateTime(row.posted_at)}
          {row.is_recon ? (
            <Badge
              variant="outline"
              className="ml-1 border-primary/20 text-brand-text"
            >
              recon
            </Badge>
          ) : null}
        </td>
        <td className="px-3 py-3 text-right">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onView}
            className="h-8 rounded-lg border-gray-200/80"
          >
            Lihat
          </Button>
        </td>
      </tr>
      {expanded ? (
        <tr className="border-b border-gray-200/70 bg-muted/20">
          <td colSpan={10} className="px-4 py-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-1.5">Akun</th>
                  <th className="px-2 py-1.5 text-right">Debit</th>
                  <th className="px-2 py-1.5 text-right">Credit</th>
                  <th className="px-2 py-1.5">Memo</th>
                </tr>
              </thead>
              <tbody>
                {(row.lines ?? []).map((line) => (
                  <tr key={line.id} className="border-t border-gray-200/50">
                    <td className="px-2 py-1.5 text-foreground">
                      <span className="font-mono text-xs text-muted-foreground">
                        {line.account_code || "—"}
                      </span>
                      <span className="ml-2">{line.account_name || "—"}</span>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {line.entry_side === "DEBIT"
                        ? formatLedgerAmount(line.amount)
                        : ""}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {line.entry_side === "CREDIT"
                        ? formatLedgerAmount(line.amount)
                        : ""}
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground">
                      {line.memo || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      ) : null}
    </>
  );
}

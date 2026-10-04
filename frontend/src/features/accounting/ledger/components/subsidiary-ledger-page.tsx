"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ClipboardDocumentListIcon } from "@heroicons/react/24/outline";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { filterComboboxClassName } from "@/components/layout/form-field";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { formatNumber } from "@/lib/format";
import type { SubsidiaryKind } from "../api";
import { useSubsidiaryLedger, useSubsidiaryParties } from "../queries";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function yearStartStr() {
  return `${todayStr().slice(0, 4)}-01-01`;
}

const KIND_OPTIONS = [
  { value: "AP", label: "Accounts Payable (Vendor)" },
  { value: "AR", label: "Accounts Receivable (Customer)" },
];

const DOC_LABEL: Record<string, string> = {
  invoice: "Invoice",
  payment: "Payment",
  receipt: "Receipt",
};

export function SubsidiaryLedgerPage() {
  const [kind, setKind] = useState<SubsidiaryKind>("AP");
  const [partyKey, setPartyKey] = useState("");
  const [dateFrom, setDateFrom] = useState(yearStartStr());
  const [dateTo, setDateTo] = useState(todayStr());

  const partiesQuery = useSubsidiaryParties(kind);
  const ledgerQuery = useSubsidiaryLedger(
    kind,
    partyKey || null,
    dateFrom,
    dateTo
  );

  const partyOptions = useMemo(
    () =>
      (partiesQuery.data ?? []).map((p) => ({
        value: p.party_key,
        label: p.party_name,
        description: `${p.invoice_count} invoice · outstanding ${formatNumber(p.outstanding)}`,
      })),
    [partiesQuery.data]
  );

  const data = ledgerQuery.data;

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200/70 pb-4">
        <h1 className="text-2xl font-bold text-foreground">Subsidiary Ledger</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Buku pembantu per vendor (AP) atau customer (AR), dari dokumen Accounting.
        </p>
      </div>

      <PurchasingListSection
        icon={ClipboardDocumentListIcon}
        title="Buku Pembantu"
        description="Debit = invoice / pengakuan; Credit = payment / receipt."
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <Combobox
              options={KIND_OPTIONS}
              value={kind}
              onChange={(v) => {
                setKind(v as SubsidiaryKind);
                setPartyKey("");
              }}
              placeholder="Jenis..."
              searchPlaceholder="Cari..."
              className={`${filterComboboxClassName} h-10 w-[220px] shrink-0 bg-card`}
            />
            <Combobox
              options={partyOptions}
              value={partyKey}
              onChange={setPartyKey}
              placeholder={kind === "AP" ? "Pilih vendor..." : "Pilih customer..."}
              searchPlaceholder="Cari nama..."
              allowClear
              className={`${filterComboboxClassName} h-10 min-w-[240px] flex-1 bg-card`}
              contentClassName="min-w-[320px]"
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
          </div>
        }
      >
        {!partyKey ? (
          <div className="px-4 py-14 text-center text-sm text-muted-foreground">
            Pilih {kind === "AP" ? "vendor" : "customer"} untuk menampilkan buku pembantu.
            {partiesQuery.data ? (
              <span className="mt-1 block">
                {partiesQuery.data.length} party tersedia.
                {partiesQuery.data.length === 0 ? (
                  <>
                    {" "}
                    Belum ada dokumen {kind}. Lihat{" "}
                    <Link
                      href={
                        kind === "AP"
                          ? "/dashboard/accounting/accounts-payable"
                          : "/dashboard/accounting/receivable"
                      }
                      className="text-brand-text hover:underline"
                    >
                      {kind === "AP" ? "Accounts Payable" : "Accounts Receivable"}
                    </Link>
                    .
                  </>
                ) : null}
              </span>
            ) : null}
          </div>
        ) : ledgerQuery.isLoading || partiesQuery.isLoading ? (
          <div className="px-4 py-14 text-center text-sm text-muted-foreground">
            Memuat subsidiary ledger...
          </div>
        ) : ledgerQuery.isError ? (
          <div className="px-4 py-10 text-center text-sm text-destructive">
            {ledgerQuery.error instanceof Error
              ? ledgerQuery.error.message
              : "Gagal memuat subsidiary ledger"}
          </div>
        ) : !data ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            Data tidak ditemukan.
          </div>
        ) : (
          <div className="space-y-4 px-4 pb-4">
            <div className="flex flex-wrap gap-4 border-b border-gray-200/70 pb-3 text-sm">
              <div className="font-medium text-foreground">{data.party_name}</div>
              <div>
                Opening:{" "}
                <span className="font-medium tabular-nums">
                  {formatNumber(data.opening_balance)}
                </span>
              </div>
              <div>
                Debit:{" "}
                <span className="font-medium tabular-nums">
                  {formatNumber(data.total_debit)}
                </span>
              </div>
              <div>
                Credit:{" "}
                <span className="font-medium tabular-nums">
                  {formatNumber(data.total_credit)}
                </span>
              </div>
              <div>
                Closing:{" "}
                <span className="font-medium tabular-nums">
                  {formatNumber(data.closing_balance)}
                </span>
              </div>
            </div>

            {data.lines.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                Tidak ada mutasi pada periode ini. Saldo tetap{" "}
                {formatNumber(data.closing_balance)}.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-gray-200/70 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      <th className="px-2 py-2">Tanggal</th>
                      <th className="px-2 py-2">Tipe</th>
                      <th className="px-2 py-2">No Dokumen</th>
                      <th className="px-2 py-2">Keterangan</th>
                      <th className="px-2 py-2 text-right">Debit</th>
                      <th className="px-2 py-2 text-right">Credit</th>
                      <th className="px-2 py-2 text-right">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lines.map((line) => (
                      <tr
                        key={line.line_id}
                        className="border-b border-gray-200/70 last:border-0 hover:bg-muted/30"
                      >
                        <td className="px-2 py-2 tabular-nums text-muted-foreground">
                          {line.entry_date}
                        </td>
                        <td className="px-2 py-2">
                          {DOC_LABEL[line.doc_type] || line.doc_type}
                        </td>
                        <td className="px-2 py-2 font-mono text-xs">
                          {line.doc_no}
                        </td>
                        <td className="px-2 py-2 text-foreground">
                          {line.description || "—"}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {line.debit ? formatNumber(line.debit) : "—"}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {line.credit ? formatNumber(line.credit) : "—"}
                        </td>
                        <td className="px-2 py-2 text-right font-medium tabular-nums">
                          {formatNumber(line.running_balance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </PurchasingListSection>
    </div>
  );
}

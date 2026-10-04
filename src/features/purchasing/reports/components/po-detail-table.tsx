"use client";

import { Fragment } from "react";
import Link from "next/link";
import { ChevronDownIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { formatDate, formatNumber, formatRupiah } from "@/lib/format";
import type { PODetailLine, PODetailRow } from "../types";
import { PoStatusBadge } from "./po-status-badge";
import { ReportTableMessage } from "./report-ui";

const COLUMNS = 8;

type PoDetailTableProps = {
  rows: PODetailRow[];
  loading: boolean;
  expanded: Set<string>;
  onToggle: (id: string) => void;
};

/** Tabel PO yang bisa dibuka per baris untuk melihat line item. */
export function PoDetailTable({ rows, loading, expanded, onToggle }: PoDetailTableProps) {
  return (
    <table className="w-full min-w-220 text-sm">
      <thead className="bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <tr>
          <th className="w-8 px-3 py-3" />
          <th className="px-3 py-3">No PO</th>
          <th className="px-3 py-3">Tanggal</th>
          <th className="px-3 py-3">Supplier</th>
          <th className="px-3 py-3">Status</th>
          <th className="px-3 py-3 text-right">Items</th>
          <th className="px-3 py-3 text-right">Total</th>
          <th className="px-3 py-3 text-right">Aksi</th>
        </tr>
      </thead>
      <tbody>
        {loading ? (
          <ReportTableMessage colSpan={COLUMNS}>Memuat data...</ReportTableMessage>
        ) : rows.length === 0 ? (
          <ReportTableMessage colSpan={COLUMNS}>Tidak ada data PO untuk filter ini</ReportTableMessage>
        ) : (
          rows.map((po) => {
            const open = expanded.has(po.id);
            return (
              <Fragment key={po.id}>
                <tr className="cursor-pointer border-t border-gray-200/70 hover:bg-muted/30" onClick={() => onToggle(po.id)}>
                  <td className="px-3 py-3 text-muted-foreground">
                    {open ? <ChevronDownIcon className="h-4 w-4" /> : <ChevronRightIcon className="h-4 w-4" />}
                  </td>
                  <td className="px-3 py-3 font-medium text-brand-text">{po.no_po}</td>
                  <td className="px-3 py-3 text-muted-foreground">{formatDate(po.tanggal_po)}</td>
                  <td className="px-3 py-3">
                    <div className="text-foreground">{po.supplier}</div>
                    {po.vendor_code ? <div className="text-xs text-muted-foreground">{po.vendor_code}</div> : null}
                  </td>
                  <td className="px-3 py-3">
                    <PoStatusBadge status={po.status} />
                  </td>
                  <td className="px-3 py-3 text-right text-muted-foreground">{po.item_count}</td>
                  <td className="px-3 py-3 text-right font-medium text-foreground">{formatRupiah(po.total)}</td>
                  <td className="px-3 py-3 text-right" onClick={(event) => event.stopPropagation()}>
                    <Link href={`/dashboard/purchasing/po/${po.id}`}>
                      <Button variant="outline" size="sm" className="h-8">
                        Detail
                      </Button>
                    </Link>
                  </td>
                </tr>
                {open ? (
                  <tr className="border-t border-gray-200/70 bg-muted/20">
                    <td colSpan={COLUMNS} className="px-6 py-4">
                      <PoLineItems items={po.items} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })
        )}
      </tbody>
    </table>
  );
}

function PoLineItems({ items }: { items: PODetailLine[] }) {
  if (items.length === 0) return <p className="text-xs italic text-muted-foreground">Tidak ada line item</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200/70 bg-card">
      <table className="w-full text-xs">
        <thead className="bg-muted/50 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Item</th>
            <th className="px-3 py-2">Kode</th>
            <th className="px-3 py-2 text-right">Qty Order</th>
            <th className="px-3 py-2 text-right">Qty Diterima</th>
            <th className="px-3 py-2 text-right">Harga Satuan</th>
            <th className="px-3 py-2 text-right">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-t border-gray-200/70">
              <td className="px-3 py-2 text-foreground">{item.nama_bahan}</td>
              <td className="px-3 py-2 font-mono text-muted-foreground">{item.kode_bahan || "-"}</td>
              <td className="px-3 py-2 text-right text-muted-foreground">
                {formatNumber(item.qty_order, 3)}
                {item.satuan ? ` ${item.satuan}` : ""}
              </td>
              <td
                className={`px-3 py-2 text-right font-medium ${
                  item.qty_received < item.qty_order ? "text-amber-600" : "text-emerald-600"
                }`}
              >
                {formatNumber(item.qty_received, 3)}
              </td>
              <td className="px-3 py-2 text-right text-muted-foreground">{formatRupiah(item.harga_satuan)}</td>
              <td className="px-3 py-2 text-right font-medium text-foreground">{formatRupiah(item.subtotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

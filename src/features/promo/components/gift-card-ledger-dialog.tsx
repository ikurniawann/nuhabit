"use client";

// EPIC-034 Fase A — riwayat pergerakan saldo satu gift card (isi/pakai/koreksi).

import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TableRow } from "@/components/ui/table";
import { useGiftCardLedger } from "../gift-card-queries";
import type { GiftCard } from "../gift-card-types";
import { formatDateTime, formatRupiah } from "@/lib/format";


const DIRECTION_LABELS: Record<string, string> = {
  isi: "Isi/Terbit",
  pakai: "Pakai",
  koreksi: "Koreksi",
};

const DIRECTION_BADGE: Record<string, string> = {
  isi: "bg-emerald-100 text-emerald-700",
  pakai: "bg-blue-100 text-blue-700",
  koreksi: "bg-amber-100 text-amber-700",
};

interface GiftCardLedgerDialogProps {
  card: GiftCard | null;
  onOpenChange: (open: boolean) => void;
}

export function GiftCardLedgerDialog({
  card,
  onOpenChange,
}: GiftCardLedgerDialogProps) {
  const ledgerQuery = useGiftCardLedger(card?.id ?? null);
  const entries = ledgerQuery.data ?? [];

  return (
    <Dialog open={card !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Riwayat Gift Card {card?.code}</DialogTitle>
        </DialogHeader>
        {ledgerQuery.isLoading ? (
          <div className="py-10 text-center">
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-pink-600" />
          </div>
        ) : entries.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500">
            Belum ada pergerakan saldo.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <TableRow className="border-b border-gray-200/70 bg-gray-50/80 text-xs uppercase tracking-wide text-gray-500 hover:bg-gray-50/80">
                  <th className="px-3 py-2 text-left font-semibold">Waktu</th>
                  <th className="px-3 py-2 text-left font-semibold">Arah</th>
                  <th className="px-3 py-2 text-right font-semibold">Nominal</th>
                  <th className="px-3 py-2 text-right font-semibold">Saldo Setelah</th>
                  <th className="px-3 py-2 text-left font-semibold">Konteks</th>
                </TableRow>
              </thead>
              <tbody className="divide-y divide-gray-200/50">
                {entries.map((entry) => (
                  <TableRow key={entry.id} className="hover:bg-gray-50/80">
                    <td className="px-3 py-2 text-xs text-gray-600">
                      {formatDateTime(entry.created_at)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge
                        className={`border-0 font-normal ${DIRECTION_BADGE[entry.direction] ?? ""}`}
                      >
                        {DIRECTION_LABELS[entry.direction] ?? entry.direction}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatRupiah(entry.amount)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium text-gray-900">
                      {formatRupiah(entry.balance_after)}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">
                      {entry.context_type ?? "—"}
                      {entry.note ? ` · ${entry.note}` : ""}
                      {entry.payment_reference ? ` · ref ${entry.payment_reference}` : ""}
                    </td>
                  </TableRow>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

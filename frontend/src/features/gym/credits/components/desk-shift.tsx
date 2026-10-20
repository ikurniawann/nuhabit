"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ShiftModal } from "@/components/pos/ShiftModal";
import type { PosShift } from "@/lib/pos-api";
import { formatRupiah, formatTime } from "@/lib/format";
import { gymCreditsApi, type DeskShift } from "../api";

export const deskShiftKey = (branchId: string | null) => ["gym-credits", "shift", branchId ?? "any"];

/** Shift kasir staf di cabang ini; null bila belum ada. */
export function useDeskShift(branchId: string | null, enabled = true) {
  return useQuery({ queryKey: deskShiftKey(branchId), queryFn: () => gymCreditsApi.myShift(branchId), enabled });
}

/** ShiftModal POS membaca baris pos_shifts; total berjalan diambil dari ringkasan. */
function asPosShift(shift: DeskShift): PosShift {
  return {
    id: shift.id,
    shift_number: shift.shift_number,
    cashier_id: shift.cashier_id,
    branch_id: shift.branch_id ?? undefined,
    opened_at: shift.opened_at,
    opening_cash: shift.opening_cash,
    total_orders: shift.summary.total_orders,
    total_sales: shift.summary.total_sales,
    total_refunds: shift.summary.total_refunds,
    total_cash_sales: 0,
    total_qris_sales: 0,
    total_debit_sales: 0,
    total_credit_sales: 0,
    total_ark_coin_sales: 0,
    status: "active",
  };
}

/**
 * Buka atau tutup shift kasir dari front desk dengan dialog shift POS.
 * Penjualan paket tunai, kartu, transfer dan QRIS masuk ke shift ini.
 */
export function DeskShiftDialog({
  branchId,
  shift,
  onClose,
}: {
  branchId: string | null;
  shift: DeskShift | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  // ShiftModal mounts its body per shift id: keep the shift it opened with,
  // or the refresh after closing would swap the summary for the open form.
  const [initial] = useState(shift);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["gym-credits", "shift"] });
  const failure = (error: unknown) => ({ success: false, error: error instanceof Error ? error.message : "Permintaan gagal" });

  return (
    <ShiftModal
      open
      shift={initial ? asPosShift(initial) : null}
      onClose={onClose}
      sendReport={false}
      onOpenShift={async (openingCash, notes) => {
        try {
          await gymCreditsApi.openShift(branchId, openingCash, notes);
          await refresh();
          return { success: true };
        } catch (error) {
          return failure(error);
        }
      }}
      onCloseShift={async (closingCash, notes) => {
        try {
          const summary = await gymCreditsApi.closeShift(branchId, closingCash, notes);
          await refresh();
          return { success: true, summary };
        } catch (error) {
          return failure(error);
        }
      }}
    />
  );
}

/** Status shift kasir di halaman kredit: laci, penjualan gym, buka/tutup. */
export function DeskShiftBar({ branchId }: { branchId: string | null }) {
  const shift = useDeskShift(branchId);
  const [open, setOpen] = useState(false);
  const s = shift.data;

  return (
    <Card className="flex-row flex-wrap items-center justify-between gap-3 px-5 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <Banknote className="size-5 shrink-0 text-muted-foreground" />
        {shift.isLoading ? (
          <p className="text-sm text-muted-foreground">Memeriksa shift kasir…</p>
        ) : shift.error ? (
          <p className="text-sm text-danger">{shift.error.message}</p>
        ) : s ? (
          <div className="min-w-0 text-sm">
            <p className="font-medium">
              Shift <span className="font-mono">{s.shift_number}</span> · dibuka {formatTime(s.opened_at, "—")}
            </p>
            <p className="text-xs text-muted-foreground">
              Tunai di laci {formatRupiah(s.summary.expected_cash)} · Penjualan gym {formatRupiah(s.summary.gym_sales.sales)}
              {s.summary.gym_sales.refunds > 0 && ` · Refund ${formatRupiah(s.summary.gym_sales.refunds)}`}
            </p>
          </div>
        ) : (
          <div className="min-w-0 text-sm">
            <p className="font-medium">Belum ada shift kasir</p>
            <p className="text-xs text-muted-foreground">Penjualan dan refund tunai butuh shift yang terbuka.</p>
          </div>
        )}
      </div>
      {!shift.isLoading && !shift.error && (
        <Button variant={s ? "outline" : "default"} size="sm" onClick={() => setOpen(true)}>
          {s ? "Tutup shift" : "Buka shift"}
        </Button>
      )}
      {open && <DeskShiftDialog branchId={branchId} shift={s ?? null} onClose={() => setOpen(false)} />}
    </Card>
  );
}

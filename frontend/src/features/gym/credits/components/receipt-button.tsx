"use client";

import { useState } from "react";
import { Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Can } from "@/components/iam/can";
import type { CreditPurchase } from "../api";
import { printPurchaseReceipt } from "../print-receipt";

/** Cetak ulang struk pembelian yang sudah dibayar (butuh izin lihat Kredit Member). */
export function ReceiptButton({ purchase }: { purchase: Pick<CreditPurchase, "id" | "receipt_number"> }) {
  const [busy, setBusy] = useState(false);
  if (!purchase.receipt_number) return null;
  const print = async () => {
    setBusy(true);
    try {
      await printPurchaseReceipt(purchase.id);
    } catch (error) {
      toast.error("Struk gagal dicetak", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Can menu="gym.credits" action="read">
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => void print()} aria-label={`Cetak struk ${purchase.receipt_number}`}>
        <Printer /> Struk
      </Button>
    </Can>
  );
}

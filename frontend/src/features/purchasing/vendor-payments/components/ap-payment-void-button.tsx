"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelForm,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

const MIN_REASON = 5;

async function voidPayment(id: string, reason: string): Promise<{ message: string }> {
  const res = await fetch(`/api/accounting/ap/payments/${id}/void`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || body.error || "Gagal void pembayaran");
  return body;
}

/**
 * Tombol void pembayaran AP (alasan wajib). Pembayaran VOID ditampilkan
 * sebagai badge. Dipasang di baris tabel ApPaymentsPage.
 */
export function ApPaymentVoidButton({ payment }: { payment: { id: string; payment_no: string; status: string } }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const mutation = useMutation({
    mutationFn: () => voidPayment(payment.id, reason.trim()),
    onSuccess: (data) => {
      toast.success(data.message);
      setOpen(false);
      setReason("");
      void queryClient.invalidateQueries({ queryKey: ["accounting", "ap"] });
    },
    onError: (error) => toast.error("Void gagal", { description: error.message }),
  });

  if (payment.status === "VOID") return <Badge variant="muted">Void</Badge>;
  if (payment.status !== "POSTED") return null;

  return (
    <>
      <Button variant="ghost" size="sm" className="text-danger" onClick={() => setOpen(true)}>
        <Ban /> Void
      </Button>
      <Dialog open={open} onOpenChange={(next) => !mutation.isPending && setOpen(next)}>
        <DialogPanel>
          <DialogPanelForm
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
          >
            <DialogPanelHeader>
              <DialogPanelTitle>Void {payment.payment_no}?</DialogPanelTitle>
              <DialogPanelDescription>
                Pembayaran tidak lagi mengurangi hutang invoice, termin PO dihitung ulang, dan jurnalnya dibalik.
                Tindakan ini tercatat di audit trail.
              </DialogPanelDescription>
            </DialogPanelHeader>
            <DialogPanelBody>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Alasan void</span>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Contoh: nominal salah input, transfer dibatalkan bank"
                  maxLength={500}
                  required
                />
                <span className="text-xs text-muted-foreground">Minimal {MIN_REASON} karakter.</span>
              </label>
            </DialogPanelBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={mutation.isPending}>
                Batal
              </Button>
              <Button type="submit" variant="destructive" disabled={reason.trim().length < MIN_REASON || mutation.isPending}>
                Void pembayaran
              </Button>
            </DialogFooter>
          </DialogPanelForm>
        </DialogPanel>
      </Dialog>
    </>
  );
}

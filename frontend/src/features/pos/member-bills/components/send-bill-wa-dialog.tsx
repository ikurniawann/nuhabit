"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { sendMemberBillWa } from "../api";

/** Pratinjau pesan + nomor tujuan dulu, baru kirim (pesan keluar atas nama bisnis). */
export function SendBillWaDialog({
  open,
  customerId,
  customerName,
  onOpenChange,
}: {
  open: boolean;
  customerId: string;
  customerName: string;
  onOpenChange: (open: boolean) => void;
}) {
  const preview = useQuery({
    queryKey: ["pos", "member-bills", "wa-preview", customerId],
    queryFn: () => sendMemberBillWa(customerId, true),
    enabled: open,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const send = useMutation({
    mutationFn: () => sendMemberBillWa(customerId, false),
    onSuccess: (result) => {
      toast.success(`Tagihan terkirim ke WA ${customerName} (+${result.phone})`);
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !send.isPending && onOpenChange(next)}>
      <DialogPanel size="lg">
        <DialogPanelHeader>
          <DialogPanelTitle>Kirim tagihan via WA</DialogPanelTitle>
          <DialogPanelDescription>
            {preview.data ? `Ke ${customerName} · +${preview.data.phone}` : `Ke ${customerName}`}
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody>
          {preview.isLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Menyusun pesan…
            </div>
          ) : preview.error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
              {(preview.error as Error).message}
            </div>
          ) : preview.data ? (
            <div className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-xl bg-emerald-50 p-4 text-sm leading-relaxed text-gray-900 dark:bg-emerald-500/10 dark:text-gray-100">
              {preview.data.message}
            </div>
          ) : null}
        </DialogPanelBody>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={send.isPending} onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button type="button" disabled={!preview.data || send.isPending} onClick={() => send.mutate()}>
            {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
            Kirim WA
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}

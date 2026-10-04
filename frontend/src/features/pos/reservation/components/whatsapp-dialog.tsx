"use client";

import { MessageSquare } from "lucide-react";
import { toast } from "sonner";
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
import { whatsAppMessage, whatsAppPhone, type WhatsAppKind } from "../reservation-rules";
import type { ReservationRow } from "../types";

export function WhatsAppDialog({
  target,
  onClose,
}: {
  target: { reservation: ReservationRow; kind: WhatsAppKind } | null;
  onClose: () => void;
}) {
  function send() {
    if (!target) return;
    const phone = whatsAppPhone(target.reservation);
    if (!phone) {
      toast.error("No phone number for this guest");
      return;
    }
    const message = whatsAppMessage(target.reservation, target.kind);
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, "_blank");
    onClose();
  }

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="md">
        <DialogPanelHeader>
          <DialogPanelTitle className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-emerald-600" />
            Send WhatsApp
          </DialogPanelTitle>
          <DialogPanelDescription>Preview the message before opening WhatsApp.</DialogPanelDescription>
        </DialogPanelHeader>
        {target ? (
          <DialogPanelBody>
            <div className="whitespace-pre-line rounded-lg border border-emerald-200/70 bg-emerald-50/60 p-3 text-xs text-foreground">
              {whatsAppMessage(target.reservation, target.kind)}
            </div>
          </DialogPanelBody>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" className="border-gray-200/80" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={send}>
            <MessageSquare className="mr-2 h-4 w-4" />
            Send via WhatsApp
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}

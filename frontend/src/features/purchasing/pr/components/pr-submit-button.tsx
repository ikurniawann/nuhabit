"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
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
import { useSubmitPurchaseRequest } from "../mutations";

/** Ajukan PR draft apa adanya ke persetujuan head departemen, tanpa membuka form ubah. */
export function PRSubmitButton({ prId }: { prId: string }) {
  const [open, setOpen] = useState(false);
  const submit = useSubmitPurchaseRequest();

  async function handleSubmit() {
    try {
      await submit.mutateAsync(prId);
      toast.success("Purchase request diajukan untuk persetujuan");
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal mengajukan purchase request");
    }
  }

  return (
    <>
      <Button type="button" className="purchasing-main-button w-full sm:w-auto" onClick={() => setOpen(true)}>
        <Send className="mr-2 h-4 w-4" />
        Ajukan
      </Button>

      <Dialog open={open} onOpenChange={(next) => !submit.isPending && setOpen(next)}>
        <DialogPanel size="xs">
          <DialogPanelHeader>
            <DialogPanelTitle>Ajukan Purchase Request?</DialogPanelTitle>
            <DialogPanelDescription>
              Permintaan dikirim ke head departemen untuk disetujui. Setelah diajukan, item dan qty tidak bisa diubah
              lagi.
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody />
          <DialogFooter className="px-6 py-4">
            <Button
              type="button"
              variant="outline"
              className="purchasing-secondary-button"
              onClick={() => setOpen(false)}
              disabled={submit.isPending}
            >
              Batal
            </Button>
            <Button type="button" className="purchasing-main-button" onClick={handleSubmit} disabled={submit.isPending}>
              {submit.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {submit.isPending ? "Mengajukan..." : "Ajukan Sekarang"}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>
    </>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { RM_ROUTES } from "@/lib/purchasing/item-routes";

type PRRevisionButtonProps = {
  prId: string;
};

export function PRRevisionButton({ prId }: PRRevisionButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function createRevision() {
    setLoading(true);
    try {
      const response = await fetch(`/api/purchasing/pr/${prId}/revise`, {
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Gagal membuat revisi purchase request");
      }

      setOpen(false);
      router.push(`${RM_ROUTES.purchasingPrEdit(payload.data.id)}?revision=created`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Gagal membuat revisi purchase request"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="purchasing-secondary-button w-full sm:w-auto"
        onClick={() => setOpen(true)}
      >
        <FileText className="mr-2 h-4 w-4" />
        Buat Revisi
      </Button>

      <Dialog open={open} onOpenChange={(open) => !loading && setOpen(open)}>
        <DialogPanel size="xs">
          <DialogPanelHeader>
            <DialogPanelTitle>Buat Revisi?</DialogPanelTitle>
            <DialogPanelDescription>
              Draf purchase request baru akan dibuat dari permintaan yang ditolak ini. Permintaan
              asli tetap tersimpan di riwayat.
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody />
          <DialogFooter className="px-6 py-4">
            <Button
              type="button"
              variant="outline"
              className="purchasing-secondary-button"
              onClick={() => setOpen(false)}
              disabled={loading}
            >
              Batal
            </Button>
            <Button
              type="button"
              className="purchasing-main-button"
              onClick={createRevision}
              disabled={loading}
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {loading ? "Membuat..." : "Buat Revisi"}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>
    </>
  );
}

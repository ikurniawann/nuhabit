"use client";

import { Loader2 } from "lucide-react";
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

interface MasterDeleteDialogProps {
  open: boolean;
  title: string;
  description: string;
  isDeleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function MasterDeleteDialog({
  open,
  title,
  description,
  isDeleting,
  onClose,
  onConfirm,
}: MasterDeleteDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPanel size="xs">
        <DialogPanelHeader>
          <DialogPanelTitle>{title}</DialogPanelTitle>
          <DialogPanelDescription>{description}</DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody />
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isDeleting}
            className="h-10 rounded-lg border-gray-200/80"
          >
            Batal
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onConfirm}
            disabled={isDeleting}
            className="h-10 rounded-lg border-red-200/80 text-red-600 hover:bg-red-50 hover:text-red-700"
          >
            {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Hapus"}
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}

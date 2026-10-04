"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { Loader2 } from "lucide-react";
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
import { shouldConfirmClearCart } from "@/lib/pos/central-cashier";
import { POS_CART_STORAGE_KEY } from "@/lib/pos/pos-sell-stall";

const CanUseCentralCashierContext = createContext(false);

export function CanUseCentralCashierProvider({
  value,
  children,
}: {
  value: boolean;
  children: React.ReactNode;
}) {
  return (
    <CanUseCentralCashierContext.Provider value={value}>
      {children}
    </CanUseCentralCashierContext.Provider>
  );
}

export function useCanUseCentralCashier() {
  return useContext(CanUseCentralCashierContext);
}

type ConfirmStallSwitchDialogProps = {
  open: boolean;
  switching: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

export function ConfirmStallSwitchDialog({
  open,
  switching,
  onOpenChange,
  onConfirm,
}: ConfirmStallSwitchDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && switching) return;
        onOpenChange(next);
      }}
    >
      <DialogPanel size="xs" showCloseButton={!switching}>
        <DialogPanelHeader>
          <DialogPanelTitle>Ganti stall</DialogPanelTitle>
          <DialogPanelDescription>
            Keranjang akan dikosongkan karena stall diganti. Lanjut?
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody />
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={switching}
            className="h-10 rounded-lg border-gray-200/80"
          >
            Batal
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={switching}
            className="h-10 gap-2 rounded-lg"
          >
            {switching ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Ganti stall
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}

async function postActiveStall(warehouseId: string | null): Promise<void> {
  const res = await fetch("/api/auth/active-stall", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ warehouse_id: warehouseId }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "Gagal mengganti stall");
}

function clearPosCartStorage(): void {
  try {
    localStorage.removeItem(POS_CART_STORAGE_KEY);
  } catch {
    toast.error("Keranjang mungkin masih tersisa di perangkat ini");
  }
}

export function useConfirmAndSwitchStall() {
  const [pendingWarehouseId, setPendingWarehouseId] = useState<
    string | null | undefined
  >(undefined);
  const [switching, setSwitching] = useState(false);

  const dialogOpen = pendingWarehouseId !== undefined;

  const performSwitch = useCallback(async (warehouseId: string | null) => {
    setSwitching(true);
    try {
      clearPosCartStorage();
      await postActiveStall(warehouseId);
      window.location.reload();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Gagal mengganti stall"
      );
      setSwitching(false);
    }
  }, []);

  const confirmAndSwitchStall = useCallback(
    async (warehouseId: string | null): Promise<void> => {
      if (switching) return;
      let needsConfirm = false;
      try {
        needsConfirm = shouldConfirmClearCart(
          localStorage.getItem(POS_CART_STORAGE_KEY)
        );
      } catch {
        needsConfirm = false;
      }
      if (needsConfirm) {
        setPendingWarehouseId(warehouseId);
        return;
      }
      await performSwitch(warehouseId);
    },
    [performSwitch, switching]
  );

  const dialog = (
    <ConfirmStallSwitchDialog
      open={dialogOpen}
      switching={switching}
      onOpenChange={(open) => {
        if (!open && !switching) setPendingWarehouseId(undefined);
      }}
      onConfirm={() => {
        if (pendingWarehouseId === undefined) return;
        void performSwitch(pendingWarehouseId);
      }}
    />
  );

  return { confirmAndSwitchStall, switching, dialogOpen, dialog };
}

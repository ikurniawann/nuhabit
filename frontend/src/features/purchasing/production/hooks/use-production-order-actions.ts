"use client";

import { useState } from "react";
import { toast } from "sonner";
import { buildQuickCompletePayload, countShortMaterials } from "@/lib/purchasing/production-ui-order-form";
import { getProductionOrder } from "../api";
import { useUpdateProductionOrder } from "../mutations";

type PendingAction = { id: string; type: "release" | "start" | "receive" };

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/** Aksi baris di daftar order produksi: dirilis, mulai, dan terima output cepat. */
export function useProductionOrderActions() {
  const mutation = useUpdateProductionOrder();
  const [pending, setPending] = useState<PendingAction | null>(null);

  const advance = async (orderId: string, action: "release" | "start") => {
    setPending({ id: orderId, type: action });
    try {
      const message = await mutation.mutateAsync({ id: orderId, payload: { action } });
      toast.success(message || `Order produksi ${action === "release" ? "dirilis" : "dimulai"}`);
    } catch (error) {
      toast.error(errorMessage(error, "Gagal memperbarui order produksi"));
    } finally {
      setPending(null);
    }
  };

  /** Posting output dengan qty rencana; ditolak bila ada bahan kurang stok. Mengembalikan true bila sukses. */
  const receive = async (orderId: string): Promise<boolean> => {
    setPending({ id: orderId, type: "receive" });
    try {
      const detail = await getProductionOrder(orderId);
      const shortages = countShortMaterials(detail);
      if (shortages > 0) {
        toast.error(
          `Tidak dapat menerima output: ${shortages} bahan kurang stok. Buka detail order untuk meninjau stok.`
        );
        return false;
      }
      const message = await mutation.mutateAsync({ id: orderId, payload: buildQuickCompletePayload(detail) });
      toast.success(message || "Output diterima ke inventori");
      return true;
    } catch (error) {
      toast.error(errorMessage(error, "Gagal menerima output produksi"));
      return false;
    } finally {
      setPending(null);
    }
  };

  return { pending, advance, receive };
}

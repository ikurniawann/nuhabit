"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  removeStaticQris,
  setStaticQrisEnabled,
  updatePaymentGateway,
  uploadStaticQris,
} from "./api";
import { paymentGatewaysQueryKeys } from "./query-keys";
import type { StaticQrisConfig, UpdatePaymentGatewayPayload } from "./types";

export function useUpdatePaymentGateway() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: UpdatePaymentGatewayPayload) =>
      updatePaymentGateway(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: paymentGatewaysQueryKeys.all,
      });
      toast.success("Payment gateway settings saved.");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to save settings",
      );
    },
  });
}

type StaticQrisAction =
  | { type: "upload"; file: File }
  | { type: "toggle"; enabled: boolean }
  | { type: "remove" };

export function useStaticQrisMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (action: StaticQrisAction): Promise<StaticQrisConfig> => {
      if (action.type === "upload") return uploadStaticQris(action.file);
      if (action.type === "toggle") return setStaticQrisEnabled(action.enabled);
      return removeStaticQris();
    },
    onSuccess: (data, action) => {
      queryClient.setQueryData(paymentGatewaysQueryKeys.staticQris(), data);
      toast.success(
        action.type === "upload"
          ? "Gambar Static QRIS tersimpan."
          : action.type === "remove"
            ? "Static QRIS dihapus."
            : data.enabled
              ? "Static QRIS diaktifkan."
              : "Static QRIS dinonaktifkan.",
      );
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Gagal menyimpan Static QRIS",
      );
    },
  });
}

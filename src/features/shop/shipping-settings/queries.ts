"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiPatch, apiPost } from "@/lib/api-client";

export type ShippingSettings = {
  id: string;
  provider: "biteship" | "rajaongkir";
  origin_area_id: string | null;
  origin_district_id: string | null;
  origin_label: string | null;
  origin_postal_code: string | null;
  origin_address: string | null;
  origin_contact_name: string | null;
  origin_contact_phone: string | null;
  couriers: string;
  markup_amount: number | string;
};

export type RateQuote = {
  courierName: string;
  serviceName: string;
  price: number;
  total_price: number;
  etd: string | null;
};

const settingsKey = ["shop", "shipping-settings"] as const;

export const useShippingSettings = () =>
  useQuery({
    queryKey: settingsKey,
    queryFn: () => apiGet<{ data: ShippingSettings }>("/api/shop/shipping/settings").then((res) => res.data),
  });

/** PATCH sebagian field; `successMessage` ikut variabel supaya tiap tombol punya toast sendiri. */
export function useUpdateShippingSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ patch }: { patch: Record<string, unknown>; successMessage: string }) =>
      apiPatch<{ data: ShippingSettings }>("/api/shop/shipping/settings", patch).then((res) => res.data),
    onSuccess: (settings, { successMessage }) => {
      queryClient.setQueryData(settingsKey, settings);
      toast.success(successMessage);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Gagal menyimpan"),
  });
}

export const useRateTest = () =>
  useMutation({
    mutationFn: (input: { destination_id: string; destination_postal_code: string | null; weight_gram: number }) =>
      apiPost<{ data: RateQuote[] }>("/api/shop/shipping/rates", input).then((res) => res.data ?? []),
    onSuccess: (quotes) => {
      if (quotes.length === 0) toast.info("Tidak ada tarif — cek kurir aktif / area tujuan");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Gagal cek tarif"),
  });

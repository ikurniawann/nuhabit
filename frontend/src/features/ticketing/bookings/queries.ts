"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  cancelBooking,
  clearWebhookAlert,
  fetchBookingDetail,
  fetchBookings,
  fetchOccupancy,
  redeemBooking,
  resendBookingWa,
  saveRefundNote,
} from "./api";
import type { BookingFilters, RedeemBand } from "./types";

export const bookingQueryKeys = {
  all: ["ticketing", "bookings"] as const,
  list: (filters: BookingFilters) => ["ticketing", "bookings", filters] as const,
  detail: (id: string) => ["ticketing", "bookings", "detail", id] as const,
  occupancy: (from: string, to: string) =>
    ["ticketing", "occupancy", from, to] as const,
};

export const useBookings = (filters: BookingFilters) =>
  useQuery({
    queryKey: bookingQueryKeys.list(filters),
    queryFn: () => fetchBookings(filters),
  });

export const useOccupancy = (from: string, to: string) =>
  useQuery({
    queryKey: bookingQueryKeys.occupancy(from, to),
    queryFn: () => fetchOccupancy(from, to),
  });

export const useBookingDetail = (id: string | null) =>
  useQuery({
    queryKey: bookingQueryKeys.detail(id ?? ""),
    queryFn: () => fetchBookingDetail(id!),
    enabled: id !== null,
  });

function useBookingMutation<TVariables>(
  mutationFn: (variables: TVariables) => Promise<unknown>,
  successMessage: string,
  onSuccess?: () => void
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      toast.success(successMessage);
      queryClient.invalidateQueries({ queryKey: bookingQueryKeys.all });
      onSuccess?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export const useRedeemBooking = (onSuccess?: (visitId: string) => void) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, bands }: { id: string; bands: RedeemBand[] }) =>
      redeemBooking(id, bands),
    onSuccess: (data) => {
      toast.success("Booking di-redeem — gelang siap dipakai");
      queryClient.invalidateQueries({ queryKey: bookingQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: ["ticketing", "visits"] });
      queryClient.invalidateQueries({ queryKey: ["ticketing", "bands"] });
      queryClient.invalidateQueries({ queryKey: ["ticketing", "tab-stats"] });
      onSuccess?.(data.visit_id);
    },
    onError: (error: Error) => toast.error(error.message),
  });
};

export const useCancelBooking = (onSuccess?: () => void) =>
  useBookingMutation(
    ({ id, refundNote }: { id: string; refundNote: string | null }) =>
      cancelBooking(id, refundNote),
    "Booking dibatalkan",
    onSuccess
  );

export const useSaveRefundNote = (onSuccess?: () => void) =>
  useBookingMutation(
    ({ id, refundNote }: { id: string; refundNote: string }) =>
      saveRefundNote(id, refundNote),
    "Catatan refund tersimpan",
    onSuccess
  );

export const useClearWebhookAlert = () =>
  useBookingMutation(
    ({ id }: { id: string }) => clearWebhookAlert(id),
    "Alert ditandai selesai"
  );

export const useResendBookingWa = () =>
  useBookingMutation(({ id }: { id: string }) => resendBookingWa(id), "WA terkirim ulang");

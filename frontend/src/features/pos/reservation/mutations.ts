"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { patchReservationStatus, saveReservation } from "./api";
import { reservationQueryKeys } from "./query-keys";
import type { CreateReservationPayload, ReservationStatus } from "./types";

export const useCreateReservation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateReservationPayload) => saveReservation(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reservationQueryKeys.all });
    },
  });
};

export const useUpdateReservationStatus = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: ReservationStatus }) =>
      patchReservationStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reservationQueryKeys.all });
    },
  });
};

"use client";

import { useQuery } from "@tanstack/react-query";
import {
  listReservationCustomers,
  listReservations,
  listReservationTables,
} from "./api";
import { reservationQueryKeys } from "./query-keys";
import type { ReservationListParams } from "./types";

export const useReservationList = (params: ReservationListParams) =>
  useQuery({
    queryKey: reservationQueryKeys.list(params),
    queryFn: () => listReservations(params),
  });

export const useReservationCustomers = () =>
  useQuery({
    queryKey: reservationQueryKeys.customers(),
    queryFn: listReservationCustomers,
  });

export const useReservationTables = () =>
  useQuery({
    queryKey: reservationQueryKeys.tables(),
    queryFn: listReservationTables,
  });

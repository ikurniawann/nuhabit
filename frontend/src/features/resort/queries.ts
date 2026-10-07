"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api-client";
import type {
  AvailabilityType, FrontOfficeBoard, RateSeasonRow, ReservationDetail, ReservationListRow, RoomRow, RoomTypeRow,
} from "@/lib/resort/types";

/** Data modul Resort lewat React Query; semua mutasi menyegarkan kunci ["resort"]. */

export const resortKeys = {
  all: ["resort"] as const,
  reservations: (filters: ReservationQuery) => ["resort", "reservations", filters] as const,
  availability: (checkIn: string, checkOut: string) => ["resort", "availability", checkIn, checkOut] as const,
  frontOffice: (date: string) => ["resort", "front-office", date] as const,
  roomTypes: ["resort", "room-types"] as const,
  rooms: ["resort", "rooms"] as const,
  reservation: (id: string) => ["resort", "reservation", id] as const,
};

export interface ReservationQuery { status: string; from: string; to: string; search: string }

type Envelope<T> = { data: T };
const data = <T>(url: string) => () => apiGet<Envelope<T>>(url).then((res) => res.data);

export function useReservations(filters: ReservationQuery) {
  const qs = new URLSearchParams({ status: filters.status, from: filters.from, to: filters.to });
  if (filters.search) qs.set("search", filters.search);
  return useQuery({
    queryKey: resortKeys.reservations(filters),
    queryFn: data<ReservationListRow[]>(`/api/resort/reservations?${qs.toString()}`),
  });
}

export function useAvailability(checkIn: string, checkOut: string) {
  return useQuery({
    queryKey: resortKeys.availability(checkIn, checkOut),
    queryFn: data<{ types: AvailabilityType[] }>(`/api/resort/availability?check_in=${checkIn}&check_out=${checkOut}`),
    enabled: checkOut > checkIn,
  });
}

export function useFrontOffice(date: string) {
  return useQuery({
    queryKey: resortKeys.frontOffice(date),
    queryFn: data<FrontOfficeBoard>(`/api/resort/front-office?date=${date}`),
    placeholderData: keepPreviousData,
  });
}

export const useRoomTypes = () =>
  useQuery({
    queryKey: resortKeys.roomTypes,
    queryFn: data<{ types: RoomTypeRow[]; seasons: RateSeasonRow[] }>("/api/resort/room-types?all=1"),
  });

export const useRooms = () => useQuery({ queryKey: resortKeys.rooms, queryFn: data<RoomRow[]>("/api/resort/rooms") });

export const useReservationDetail = (id: string) =>
  useQuery({ queryKey: resortKeys.reservation(id), queryFn: data<ReservationDetail>(`/api/resort/reservations/${id}`) });

type Message = { message?: string };

/** Mutasi Resort: toast pesan server (atau `fallback`), segarkan semua data Resort, toast galat. */
export function useResortMutation<V>(run: (vars: V) => Promise<Message>, fallback: string, onDone?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: async (res) => {
      toast.success(res.message ?? fallback);
      await queryClient.invalidateQueries({ queryKey: resortKeys.all });
      onDone?.();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Gagal menyimpan"),
  });
}

export const resortApi = {
  createReservation: (body: unknown) => apiPost<Message>("/api/resort/reservations", body),
  changeStatus: (id: string, body: Record<string, unknown>) => apiPost<Message>(`/api/resort/reservations/${id}/status`, body),
  addCharge: (id: string, body: unknown) => apiPost<Message>(`/api/resort/reservations/${id}/charges`, body),
  saveRoomType: (id: string | null, body: unknown) =>
    id ? apiPatch<Message>(`/api/resort/room-types/${id}`, body) : apiPost<Message>("/api/resort/room-types", body),
  deleteRoomType: (id: string) => apiDelete(`/api/resort/room-types/${id}`) as Promise<Message>,
  saveRoom: (id: string | null, body: unknown) =>
    id ? apiPatch<Message>(`/api/resort/rooms/${id}`, body) : apiPost<Message>("/api/resort/rooms", body),
  deleteRoom: (id: string) => apiDelete(`/api/resort/rooms/${id}`) as Promise<Message>,
};

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  createCapacityDate,
  deleteCapacityDate,
  fetchOccupancyRange,
  fetchBands,
  fetchCapacityDates,
  fetchChannels,
  fetchSettings,
  fetchStaffPasses,
  pairStaffPass,
  registerBand,
  revokeStaffPass,
  searchEmployees,
  updateBand,
  createTimeSlot,
  deleteTimeSlot,
  fetchTimeSlots,
  updateCapacityDate,
  updateChannel,
  updateTimeSlot,
  updateSettings,
} from "./api";
import type {
  BandFilters,
  CapacityDateFormValues,
  SettingsFormValues,
  TicketBand,
  TimeSlotFormValues,
} from "./types";

export const ticketingQueryKeys = {
  all: ["ticketing"] as const,
  settings: ["ticketing", "settings"] as const,
  channels: ["ticketing", "channels"] as const,
  bands: (filters: BandFilters) => ["ticketing", "bands", filters] as const,
  bandsAll: ["ticketing", "bands"] as const,
  staffPasses: (q: string) => ["ticketing", "staff-passes", q] as const,
  staffPassesAll: ["ticketing", "staff-passes"] as const,
  employeeOptions: (q: string) => ["ticketing", "employee-options", q] as const,
  capacityDates: ["ticketing", "capacity-dates"] as const,
  timeSlots: ["ticketing", "time-slots"] as const,
};

// Settings dipanggil pertama — GET-nya sekaligus bootstrap kanal default
// venue (walk-in/website).
export const useTicketingSettings = () =>
  useQuery({ queryKey: ticketingQueryKeys.settings, queryFn: fetchSettings });

export const useChannels = () =>
  useQuery({ queryKey: ticketingQueryKeys.channels, queryFn: fetchChannels });

export const useBands = (filters: BandFilters) =>
  useQuery({
    queryKey: ticketingQueryKeys.bands(filters),
    queryFn: () => fetchBands(filters),
  });

function useInvalidatingMutation<TVariables>(
  mutationFn: (variables: TVariables) => Promise<unknown>,
  successMessage: string,
  keys: readonly (readonly string[])[],
  onSuccess?: () => void
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      toast.success(successMessage);
      for (const key of keys) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      onSuccess?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export const useUpdateSettings = (onSuccess?: () => void) =>
  useInvalidatingMutation(
    (values: SettingsFormValues) => updateSettings(values),
    "Pengaturan tersimpan",
    [ticketingQueryKeys.settings],
    onSuccess
  );

export const useUpdateChannel = () =>
  useInvalidatingMutation(
    ({ id, values }: { id: string; values: { name?: string; is_active?: boolean } }) =>
      updateChannel(id, values),
    "Kanal diperbarui",
    [ticketingQueryKeys.channels]
  );

export const useRegisterBand = (onSuccess?: () => void) =>
  useInvalidatingMutation(
    (values: { nfc_uid: string; label: string | null }) => registerBand(values),
    "Gelang terdaftar",
    [ticketingQueryKeys.bandsAll],
    onSuccess
  );

export const useUpdateBand = (onSuccess?: () => void) =>
  useInvalidatingMutation(
    ({
      id,
      values,
    }: {
      id: string;
      values: { label?: string | null; status?: TicketBand["status"] };
    }) => updateBand(id, values),
    "Gelang diperbarui",
    [ticketingQueryKeys.bandsAll],
    onSuccess
  );

// ── Kapasitas harian (EPIC-031) ──
export const useOccupancyRange = (from: string, to: string) =>
  useQuery({
    queryKey: ["ticketing", "occupancy", from, to] as const,
    queryFn: () => fetchOccupancyRange(from, to),
  });

export const useCapacityDates = () =>
  useQuery({
    queryKey: ticketingQueryKeys.capacityDates,
    queryFn: fetchCapacityDates,
  });

export const useCreateCapacityDate = (onSuccess?: () => void) =>
  useInvalidatingMutation(
    (values: CapacityDateFormValues) => createCapacityDate(values),
    "Override kapasitas ditambahkan",
    [ticketingQueryKeys.capacityDates],
    onSuccess
  );

export const useUpdateCapacityDate = () =>
  useInvalidatingMutation(
    ({
      id,
      values,
    }: {
      id: string;
      values: Partial<CapacityDateFormValues> & { is_active?: boolean };
    }) => updateCapacityDate(id, values),
    "Override kapasitas diperbarui",
    [ticketingQueryKeys.capacityDates]
  );

export const useDeleteCapacityDate = () =>
  useInvalidatingMutation(
    (id: string) => deleteCapacityDate(id),
    "Override kapasitas dihapus",
    [ticketingQueryKeys.capacityDates]
  );

// ── Slot waktu timed-entry (EPIC-031 D) ──
export const useTimeSlots = () =>
  useQuery({
    queryKey: ticketingQueryKeys.timeSlots,
    queryFn: fetchTimeSlots,
  });

export const useCreateTimeSlot = (onSuccess?: () => void) =>
  useInvalidatingMutation(
    (values: TimeSlotFormValues) => createTimeSlot(values),
    "Slot waktu ditambahkan",
    [ticketingQueryKeys.timeSlots],
    onSuccess
  );

export const useUpdateTimeSlot = () =>
  useInvalidatingMutation(
    ({
      id,
      values,
    }: {
      id: string;
      values: Partial<TimeSlotFormValues> & { is_active?: boolean };
    }) => updateTimeSlot(id, values),
    "Slot waktu diperbarui",
    [ticketingQueryKeys.timeSlots]
  );

export const useDeleteTimeSlot = () =>
  useInvalidatingMutation(
    (id: string) => deleteTimeSlot(id),
    "Slot waktu dihapus",
    [ticketingQueryKeys.timeSlots]
  );

// ── Gelang karyawan (Fase E) ──
export const useStaffPasses = (q: string) =>
  useQuery({
    queryKey: ticketingQueryKeys.staffPasses(q),
    queryFn: () => fetchStaffPasses(q),
  });

export const useEmployeeOptions = (q: string) =>
  useQuery({
    queryKey: ticketingQueryKeys.employeeOptions(q),
    queryFn: () => searchEmployees(q),
  });

export const usePairStaffPass = (onSuccess?: () => void) =>
  useInvalidatingMutation(
    (values: { nfc_uid: string; employee_id: string }) => pairStaffPass(values),
    "Gelang dipasangkan ke karyawan",
    [ticketingQueryKeys.staffPassesAll, ticketingQueryKeys.bandsAll],
    onSuccess
  );

export const useRevokeStaffPass = () =>
  useInvalidatingMutation(
    (id: string) => revokeStaffPass(id),
    "Pairing dicabut — gelang kembali tersedia",
    [ticketingQueryKeys.staffPassesAll, ticketingQueryKeys.bandsAll]
  );

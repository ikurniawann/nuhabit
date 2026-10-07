"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteHoliday, importHolidays, saveHoliday } from "./api";
import { holidayQueryKeys } from "./query-keys";
import type { HolidayPayload } from "./types";

function useInvalidateHolidays() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: holidayQueryKeys.lists() });
}

export function useSaveHoliday() {
  const onSuccess = useInvalidateHolidays();
  return useMutation({
    mutationFn: ({ payload, id }: { payload: HolidayPayload; id?: string }) => saveHoliday(payload, id),
    onSuccess,
  });
}

export function useDeleteHoliday() {
  const onSuccess = useInvalidateHolidays();
  return useMutation({ mutationFn: deleteHoliday, onSuccess });
}

export function useImportHolidays() {
  const onSuccess = useInvalidateHolidays();
  return useMutation({ mutationFn: importHolidays, onSuccess });
}

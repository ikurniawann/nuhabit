"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  fetchEmailLog,
  fetchEmailSettings,
  resendEmail,
  saveEmailSettings,
  sendTestEmail,
  type EmailLogFilter,
  type EmailUpdatePayload,
} from "./api";

export const emailQueryKeys = {
  all: ["settings", "email"] as const,
  settings: () => [...emailQueryKeys.all, "settings"] as const,
  log: (filter: EmailLogFilter) => [...emailQueryKeys.all, "log", filter] as const,
};

export function useEmailSettings() {
  return useQuery({ queryKey: emailQueryKeys.settings(), queryFn: fetchEmailSettings, retry: false });
}

export function useSaveEmailSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (payload: EmailUpdatePayload) => saveEmailSettings(payload),
    onSuccess: (data) => {
      queryClient.setQueryData(emailQueryKeys.settings(), data);
      toast.success("Konfigurasi email tersimpan");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Gagal menyimpan konfigurasi email");
    },
  });
}

/** Kirim email uji ke alamat akun yang sedang login; error provider tampil apa adanya. */
export function useSendTestEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: sendTestEmail,
    onSettled: () => queryClient.invalidateQueries({ queryKey: [...emailQueryKeys.all, "log"] }),
  });
}

export function useEmailLog(filter: EmailLogFilter) {
  return useQuery({ queryKey: emailQueryKeys.log(filter), queryFn: () => fetchEmailLog(filter), retry: false });
}

export function useResendEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (id: string) => resendEmail(id),
    onSuccess: () => toast.success("Email dikirim ulang"),
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Gagal mengirim ulang");
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: [...emailQueryKeys.all, "log"] }),
  });
}

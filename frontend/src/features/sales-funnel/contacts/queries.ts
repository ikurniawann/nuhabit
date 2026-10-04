"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createContact, deleteContact, fetchContacts, updateContact } from "./api";
import type { ContactFilters, ContactFormValues } from "./types";

export const contactQueryKeys = {
  all: ["sales-funnel", "contacts"] as const,
  list: (filters: ContactFilters) => ["sales-funnel", "contacts", filters] as const,
};
const ACCOUNTS_KEY = ["sales-funnel", "accounts"] as const;

export const useContacts = (filters: ContactFilters, enabled = true) =>
  useQuery({ queryKey: contactQueryKeys.list(filters), queryFn: () => fetchContacts(filters), enabled });

export function useCreateContact(onSuccess?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: ContactFormValues) => createContact(values),
    onSuccess: () => {
      toast.success("Contact dibuat");
      queryClient.invalidateQueries({ queryKey: contactQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY });
      onSuccess?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useUpdateContact(onSuccess?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: string; values: Partial<ContactFormValues> }) =>
      updateContact(id, values),
    onSuccess: () => {
      toast.success("Contact diperbarui");
      queryClient.invalidateQueries({ queryKey: contactQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY });
      onSuccess?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useDeleteContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteContact(id),
    onSuccess: () => {
      toast.success("Contact dihapus");
      queryClient.invalidateQueries({ queryKey: contactQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

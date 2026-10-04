"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  bulkUpdateProductDates,
  createProduct,
  createProductDate,
  deleteProductDate,
  fetchCategories,
  fetchChannelManager,
  fetchLoketOptions,
  fetchProductDetail,
  fetchProducts,
  saveBundleItems,
  saveChannelPrices,
  toggleProductChannel,
  updateProduct,
  uploadThumbnail,
} from "./api";
import type {
  CreateDateValues,
  CreateTicketValues,
  UpdateTicketValues,
} from "./types";

export const productQueryKeys = {
  all: ["ticketing", "products"] as const,
  list: (q: string) => ["ticketing", "products", "list", q] as const,
  detail: (id: string) => ["ticketing", "products", "detail", id] as const,
  categories: (q: string) => ["ticketing", "categories", q] as const,
  loketOptions: ["ticketing", "products", "loket-options"] as const,
};

export const useProducts = (q: string) =>
  useQuery({
    queryKey: productQueryKeys.list(q),
    queryFn: () => fetchProducts(q),
  });

export const useProductDetail = (id: string) =>
  useQuery({
    queryKey: productQueryKeys.detail(id),
    queryFn: () => fetchProductDetail(id),
  });

export const useCategories = (q: string) =>
  useQuery({
    queryKey: productQueryKeys.categories(q),
    queryFn: () => fetchCategories(q),
  });

export const useLoketOptions = () =>
  useQuery({
    queryKey: productQueryKeys.loketOptions,
    queryFn: fetchLoketOptions,
  });

function useProductMutation<TVariables, TResult = unknown>(
  mutationFn: (variables: TVariables) => Promise<TResult>,
  successMessage: string,
  onSuccess?: (result: TResult) => void
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (result) => {
      toast.success(successMessage);
      queryClient.invalidateQueries({ queryKey: productQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: ["ticketing", "categories"] });
      onSuccess?.(result);
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export const useCreateProduct = (
  onSuccess?: (result: { id: string; code: string }) => void
) =>
  useProductMutation(
    (values: CreateTicketValues) => createProduct(values),
    "Ticket dibuat",
    onSuccess
  );

export const useUpdateProduct = (onSuccess?: () => void) =>
  useProductMutation(
    ({ id, values }: { id: string; values: UpdateTicketValues }) =>
      updateProduct(id, values),
    "Ticket tersimpan",
    onSuccess
  );

export const useCreateProductDate = (onSuccess?: () => void) =>
  useProductMutation(
    ({ id, values }: { id: string; values: CreateDateValues }) =>
      createProductDate(id, values),
    "Rentang tanggal ditambahkan",
    onSuccess
  );

export const useBulkUpdateDates = (onSuccess?: () => void) =>
  useProductMutation(
    ({
      id,
      values,
    }: {
      id: string;
      values: { date_kind: string; add: string[]; remove: string[] };
    }) => bulkUpdateProductDates(id, values),
    "Kalender tersimpan",
    onSuccess
  );

export const useDeleteProductDate = () =>
  useProductMutation(
    ({ id, dateId }: { id: string; dateId: string }) =>
      deleteProductDate(id, dateId),
    "Rentang tanggal dihapus"
  );

export const useChannelManager = () =>
  useQuery({
    queryKey: ["ticketing", "products", "channel-manager"] as const,
    queryFn: fetchChannelManager,
  });

export const useToggleChannel = () =>
  useProductMutation(
    ({
      id,
      values,
    }: {
      id: string;
      values: { channel_id: string; is_distributed: boolean };
    }) => toggleProductChannel(id, values),
    "Distribusi diperbarui"
  );

export const useSaveChannelPrices = (onSuccess?: () => void) =>
  useProductMutation(
    ({
      id,
      values,
    }: {
      id: string;
      values: {
        channel_id: string;
        prices: {
          variant_id: string;
          price_regular: number | null;
          price_high: number | null;
        }[];
      };
    }) => saveChannelPrices(id, values),
    "Harga kanal tersimpan",
    onSuccess
  );

export const useSaveBundleItems = (onSuccess?: () => void) =>
  useProductMutation(
    ({
      id,
      values,
    }: {
      id: string;
      values: { items: { component_variant_id: string; qty: number }[] };
    }) => saveBundleItems(id, values),
    "Komposisi paket tersimpan",
    onSuccess
  );

export const useUploadThumbnail = () =>
  useProductMutation(
    ({ id, file }: { id: string; file: File }) => uploadThumbnail(id, file),
    "Thumbnail tersimpan"
  );

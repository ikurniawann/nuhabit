"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api-client";

export type MarketplaceAccount = {
  id: string;
  channel_code: string;
  shop_id: string;
  shop_name: string | null;
  status: string;
  stock_buffer: number;
  last_pull_at: string | null;
  link_count: string;
};

export type MarketplaceListing = {
  itemId: string;
  itemName: string;
  models: Array<{ modelId: string; modelName: string; modelSku: string | null }>;
};

export type MarketplaceLink = {
  id: string;
  product_name: string;
  sku_name: string | null;
  sku_code: string | null;
  marketplace_item_id: string;
  marketplace_model_id: string | null;
  marketplace_item_name: string | null;
  last_pushed_stock: string | null;
  last_push_at: string | null;
};

export type NewMarketplaceLink = {
  account_id: string;
  product_id: string;
  sku_id: string | null;
  marketplace_item_id: string;
  marketplace_model_id: string | null;
  marketplace_item_name: string;
};

type SyncSummary = {
  pull: { imported: number; skipped: number; stockIssues: number };
  push: { pushed: number; failed: number };
};

const keys = {
  all: ["shop", "marketplace"] as const,
  accounts: ["shop", "marketplace", "accounts"] as const,
  links: (accountId: string) => ["shop", "marketplace", "links", accountId] as const,
};

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

export const useMarketplaceAccounts = () =>
  useQuery({
    queryKey: keys.accounts,
    queryFn: () =>
      apiGet<{ data: MarketplaceAccount[] }>("/api/shop/marketplace/accounts").then((res) => res.data ?? []),
  });

export const useMarketplaceLinks = (accountId: string | null) =>
  useQuery({
    queryKey: keys.links(accountId ?? ""),
    queryFn: () =>
      apiGet<{ data: MarketplaceLink[] }>(`/api/shop/marketplace/links?account_id=${accountId}`).then(
        (res) => res.data ?? []
      ),
    enabled: accountId !== null,
  });

/** Listing toko diambil manual (tombol), bukan otomatis: panggilan API Shopee mahal. */
export const useLoadListings = () =>
  useMutation({
    mutationFn: (accountId: string) =>
      apiGet<{ data: MarketplaceListing[] }>(`/api/shop/marketplace/listings?account_id=${accountId}`).then(
        (res) => res.data ?? []
      ),
    onSuccess: (listings) => {
      if (listings.length === 0) toast.info("Tidak ada listing aktif di toko ini");
    },
    onError: (error) => toast.error(errorMessage(error, "Gagal memuat listing Shopee")),
  });

export async function startShopeeConnect(): Promise<void> {
  try {
    const res = await apiGet<{ data: { auth_url: string } }>("/api/shop/marketplace/connect");
    window.location.href = res.data.auth_url;
  } catch (error) {
    toast.error(errorMessage(error, "Gagal memulai otorisasi"));
  }
}

function useMarketplaceMutation<TVariables, TResult>(
  mutationFn: (variables: TVariables) => Promise<TResult>,
  fallbackError: string,
  onSuccess?: (result: TResult, variables: TVariables) => void
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async (result, variables) => {
      onSuccess?.(result, variables);
      await queryClient.invalidateQueries({ queryKey: keys.all });
    },
    onError: (error) => toast.error(errorMessage(error, fallbackError)),
  });
}

export const useCreateMarketplaceLink = () =>
  useMarketplaceMutation(
    (link: NewMarketplaceLink) => apiPost("/api/shop/marketplace/links", link),
    "Gagal membuat mapping",
    () => toast.success("Mapping tersimpan")
  );

export const useDeleteMarketplaceLink = () =>
  useMarketplaceMutation(
    (linkId: string) => apiDelete(`/api/shop/marketplace/links?id=${linkId}`),
    "Gagal menghapus mapping"
  );

export const useUpdateStockBuffer = () =>
  useMarketplaceMutation(
    (input: { id: string; stock_buffer: number }) => apiPatch("/api/shop/marketplace/accounts", input),
    "Gagal menyimpan buffer",
    (_result, input) => toast.success(`Buffer stok = ${input.stock_buffer}`)
  );

export const useSyncMarketplaceAccount = () =>
  useMarketplaceMutation(
    (accountId: string) =>
      apiPost<{ data: SyncSummary }>("/api/shop/marketplace/sync", { account_id: accountId }).then(
        (res) => res.data
      ),
    "Sinkronisasi gagal",
    ({ pull, push }) =>
      toast.success(
        `Sync selesai — ${pull.imported} order masuk, ${push.pushed} stok terkirim` +
          (pull.stockIssues ? ` (${pull.stockIssues} masalah stok — cek Pesanan)` : "")
      )
  );

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiPatch, apiPost } from "@/lib/api-client";
import type { WholesaleAccount } from "@/features/shop/wholesale-portal/queries";

export type { WholesaleAccount };

export type WholesaleAccountForm = {
  company_name: string;
  contact_name: string;
  email: string;
  phone: string;
  discount_pct: number;
  min_order_idr: number;
  payment_terms: "invoice" | "pay_later";
  status: "active" | "disabled";
};

/** Akun plus kata sandi sekali pakai (hanya pada respons yang membuatnya). */
export type WholesaleAccountResult = WholesaleAccount & { password?: string };

export type WholesaleProductRow = {
  id: string;
  name: string;
  collection: string | null;
  price: number;
  stock: number;
  preorder_until: string | null;
  wholesale_price_idr: number | null;
  wholesale_min_qty: number;
};

export type ProductSettingsForm = {
  preorder_until: string | null;
  wholesale_price_idr: number | null;
  wholesale_min_qty: number;
};

const keys = {
  accounts: ["shop", "wholesale", "accounts"] as const,
  products: ["shop", "wholesale", "products"] as const,
};

export const useWholesaleAccounts = () =>
  useQuery({
    queryKey: keys.accounts,
    queryFn: () => apiGet<{ data: WholesaleAccount[] }>("/api/shop/wholesale/accounts").then((res) => res.data ?? []),
  });

export const useWholesaleProducts = () =>
  useQuery({
    queryKey: keys.products,
    queryFn: () => apiGet<{ data: WholesaleProductRow[] }>("/api/shop/wholesale/products").then((res) => res.data ?? []),
  });

const toBody = (form: WholesaleAccountForm) => ({ ...form, phone: form.phone.trim() || null });

/** Simpan akun: buat baru (id null) atau ubah; `resetPassword` meminta kata sandi baru. */
export function useSaveWholesaleAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, form, resetPassword }: { id: string | null; form: WholesaleAccountForm; resetPassword?: boolean }) =>
      (id
        ? apiPatch<{ data: WholesaleAccountResult }>(`/api/shop/wholesale/accounts/${id}`, {
            ...toBody(form),
            reset_password: resetPassword === true,
          })
        : apiPost<{ data: WholesaleAccountResult }>("/api/shop/wholesale/accounts", toBody(form))
      ).then((res) => res.data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.accounts });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Gagal menyimpan akun"),
  });
}

export function useSaveProductSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, form }: { id: string; form: ProductSettingsForm }) =>
      apiPatch<{ data: WholesaleProductRow }>(`/api/shop/wholesale/products/${id}`, form).then((res) => res.data),
    onSuccess: async () => {
      toast.success("Pengaturan produk tersimpan");
      await queryClient.invalidateQueries({ queryKey: keys.products });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Gagal menyimpan produk"),
  });
}

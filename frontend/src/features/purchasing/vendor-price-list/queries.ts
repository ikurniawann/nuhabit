"use client";

import { useQuery } from "@tanstack/react-query";
import { listVendorPriceLists, getVendorPriceList } from "./api";
import { vendorPriceListQueryKeys } from "./query-keys";
import type {
  ProductOption,
  UnitOption,
  VendorOption,
  VendorPriceListListParams,
} from "./types";

export function useVendorPriceList(params: VendorPriceListListParams) {
  return useQuery({
    queryKey: vendorPriceListQueryKeys.list(params),
    queryFn: () => listVendorPriceLists(params),
  });
}

export function useVendorPriceListDetail(id: string) {
  return useQuery({
    queryKey: vendorPriceListQueryKeys.detail(id),
    queryFn: () => getVendorPriceList(id),
    enabled: !!id,
  });
}

export interface VendorPriceListFormDataResult {
  vendors: VendorOption[];
  products: ProductOption[];
  units: UnitOption[];
}

export function useVendorPriceListFormData() {
  return useQuery<VendorPriceListFormDataResult>({
    queryKey: vendorPriceListQueryKeys.formData(),
    queryFn: async () => {
      const [vendorsRes, productsRes, unitsRes] = await Promise.all([
        fetch("/api/purchasing/vendors?status=active&limit=100"),
        fetch("/api/purchasing/products?is_active=true&limit=100"),
        fetch("/api/purchasing/units?is_active=true"),
      ]);

      const vendorsJson = await vendorsRes.json();
      const productsJson = await productsRes.json();
      const unitsJson = await unitsRes.json();

      if (!vendorsRes.ok) {
        throw new Error(vendorsJson.error || vendorsJson.message || "Failed to load vendors");
      }
      if (!productsRes.ok) {
        throw new Error(productsJson.error || productsJson.message || "Failed to load products");
      }
      if (!unitsRes.ok) {
        throw new Error(unitsJson.error || unitsJson.message || "Failed to load units");
      }

      return {
        vendors: (vendorsJson.data ?? []).map((vendor: { id: string; code: string; name: string }) => ({
          id: vendor.id,
          code: vendor.code,
          name: vendor.name,
        })),
        products: (productsJson.data ?? []).map(
          (product: {
            id: string;
            kode: string;
            nama: string;
            satuan_id?: string | null;
            satuan_nama?: string | null;
          }) => ({
            id: product.id,
            kode: product.kode,
            nama: product.nama,
            satuan_id: product.satuan_id,
            satuan_nama: product.satuan_nama,
          })
        ),
        units: unitsJson.data ?? [],
      };
    },
  });
}

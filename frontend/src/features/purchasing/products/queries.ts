"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  listProducts,
  getProduct,
  listBOMItems,
  getProductFormData,
  getProductEditData,
  getProductBomEditorData,
  listProductWarehouses,
} from "./api";
import { listActiveItemsLookup } from "@/features/purchasing/items/api";
import { productsQueryKeys, type ProductListParams } from "./query-keys";

export const useProductList = (params: ProductListParams) =>
  useQuery({
    queryKey: productsQueryKeys.list(params),
    queryFn: () => listProducts(params),
    placeholderData: keepPreviousData,
  });

export const useProduct = (id: string) =>
  useQuery({
    queryKey: productsQueryKeys.detail(id),
    queryFn: () => getProduct(id),
    enabled: !!id,
  });

export const useProductBOM = (id: string) =>
  useQuery({
    queryKey: productsQueryKeys.bom(id),
    queryFn: () => listBOMItems(id),
    enabled: !!id,
  });

export const useProductFormData = () =>
  useQuery({
    queryKey: productsQueryKeys.formData,
    queryFn: getProductFormData,
  });

export const useProductEditData = (id: string) =>
  useQuery({
    queryKey: productsQueryKeys.editData(id),
    queryFn: () => getProductEditData(id),
    enabled: !!id,
  });

export const useProductBomEditorData = (id: string) =>
  useQuery({
    queryKey: productsQueryKeys.bomEditorData(id),
    queryFn: () => getProductBomEditorData(id),
    enabled: !!id,
  });

export const useProductCategoryOptions = () =>
  useQuery({
    queryKey: productsQueryKeys.categories(),
    queryFn: () => listActiveItemsLookup("product-categories"),
    staleTime: 5 * 60 * 1000,
  });

export const useProductWarehouses = () =>
  useQuery({
    queryKey: productsQueryKeys.warehouses(),
    queryFn: listProductWarehouses,
    staleTime: 5 * 60 * 1000,
  });

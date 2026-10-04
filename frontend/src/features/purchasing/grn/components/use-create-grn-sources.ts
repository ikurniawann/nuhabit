"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { planWarehouseBranch, type GrnDeliveryOption } from "@/lib/purchasing/grn-ui-lines";
import type { PurchasingModuleType } from "../api";
import {
  useGrnDeliveries,
  useGrnPoBranch,
  useGrnPoLines,
  useReceivingUserScope,
  useWarehouses,
} from "../queries";

function useErrorToast(isError: boolean, message: string) {
  useEffect(() => {
    if (isError) toast.error(message, { id: message });
  }, [isError, message]);
}

/**
 * Data form Buat GRN untuk pengiriman terpilih: opsi pengiriman, item PO,
 * dan gudang dari cabang yang berlaku (cabang pengguna, pengiriman, lalu PO).
 */
export function useCreateGrnSources(moduleType: PurchasingModuleType, deliveryId: string) {
  const deliveriesQuery = useGrnDeliveries(moduleType);
  const scopeQuery = useReceivingUserScope();
  const deliveries = deliveriesQuery.data ?? [];
  const selectedDelivery: GrnDeliveryOption | null =
    deliveries.find((delivery) => delivery.id === deliveryId) ?? null;

  const poLinesQuery = useGrnPoLines(selectedDelivery?.purchase_order_id, moduleType);

  const plan = planWarehouseBranch(scopeQuery.data, selectedDelivery);
  const poBranchQuery = useGrnPoBranch(plan.kind === "lookup-po" ? plan.poId : null);
  const branchId =
    plan.kind === "ready"
      ? plan.branchId
      : plan.kind === "lookup-po" && poBranchQuery.isFetched
        ? (poBranchQuery.data ?? null)
        : undefined;
  const warehousesQuery = useWarehouses(branchId);

  useErrorToast(deliveriesQuery.isError, "Gagal memuat data pengiriman.");
  useErrorToast(scopeQuery.isError, "Gagal memuat scope cabang pengguna.");
  useErrorToast(poLinesQuery.isError, "Gagal memuat item purchase order.");
  useErrorToast(warehousesQuery.isError, "Gagal memuat data gudang.");

  return {
    deliveries,
    deliveriesLoaded: deliveriesQuery.isSuccess,
    fetchingDeliveries: deliveriesQuery.isLoading,
    selectedDelivery,
    poLines: selectedDelivery ? (poLinesQuery.data ?? []) : [],
    fetchingPoLines: poLinesQuery.isLoading,
    warehouses: selectedDelivery && branchId !== undefined ? (warehousesQuery.data ?? []) : [],
    fetchingWarehouses: warehousesQuery.isLoading,
  };
}

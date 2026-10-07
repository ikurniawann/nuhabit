"use client";

import { useQuery } from "@tanstack/react-query";
import { getStaticQris, listPaymentGateways } from "./api";
import { paymentGatewaysQueryKeys } from "./query-keys";

export function usePaymentGateways() {
  return useQuery({
    queryKey: paymentGatewaysQueryKeys.list(),
    queryFn: listPaymentGateways,
  });
}

export function useStaticQris() {
  return useQuery({
    queryKey: paymentGatewaysQueryKeys.staticQris(),
    queryFn: getStaticQris,
  });
}

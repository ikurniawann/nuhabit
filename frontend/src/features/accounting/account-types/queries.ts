"use client";

import { useQuery } from "@tanstack/react-query";
import { accountTypesQueryKeys } from "./query-keys";
import { fetchAccountTypeList } from "./api";

export const useAccountTypeList = () =>
  useQuery({
    queryKey: accountTypesQueryKeys.list(),
    queryFn: fetchAccountTypeList,
  });

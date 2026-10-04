"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchLoans } from "./api";
import { loanQueryKeys } from "./query-keys";

export const useLoans = (status: string) =>
  useQuery({ queryKey: loanQueryKeys.list(status), queryFn: () => fetchLoans(status) });

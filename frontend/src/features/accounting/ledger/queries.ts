"use client";

import { useQuery } from "@tanstack/react-query";
import {
  fetchSubsidiaryLedger,
  fetchSubsidiaryParties,
  type SubsidiaryKind,
} from "./api";
import { subsidiaryKeys } from "./query-keys";

export function useSubsidiaryParties(kind: SubsidiaryKind) {
  return useQuery({
    queryKey: subsidiaryKeys.parties(kind),
    queryFn: () => fetchSubsidiaryParties(kind),
  });
}

export function useSubsidiaryLedger(
  kind: SubsidiaryKind,
  partyKey: string | null,
  dateFrom: string,
  dateTo: string
) {
  return useQuery({
    queryKey: subsidiaryKeys.ledger(
      kind,
      partyKey || "",
      dateFrom,
      dateTo
    ),
    queryFn: () =>
      fetchSubsidiaryLedger(kind, partyKey!, dateFrom, dateTo),
    enabled: Boolean(partyKey),
  });
}

import { apiGet, buildListUrl } from "@/lib/api-client";
import type {
  SubsidiaryKind,
  SubsidiaryLedgerReport,
  SubsidiaryPartyOption,
} from "@/lib/accounting/subsidiary-ledger-store";

const BASE = "/api/accounting/ledger/subsidiary";

export type { SubsidiaryKind, SubsidiaryLedgerReport, SubsidiaryPartyOption };

export const fetchSubsidiaryParties = (kind: SubsidiaryKind) =>
  apiGet<{ data: SubsidiaryPartyOption[] }>(
    buildListUrl(BASE, { kind })
  ).then((r) => r.data);

export const fetchSubsidiaryLedger = (
  kind: SubsidiaryKind,
  partyKey: string,
  dateFrom?: string,
  dateTo?: string
) =>
  apiGet<{ data: SubsidiaryLedgerReport }>(
    buildListUrl(BASE, {
      kind,
      party_key: partyKey,
      date_from: dateFrom,
      date_to: dateTo,
    })
  ).then((r) => r.data);

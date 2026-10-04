export type CashierNfcAction = "select" | "create" | "topup";

export function resolveCashierNfcAction(input: {
  memberFound: boolean;
  balance: number;
  totalDue: number;
  /** True when paying / NFC payment modal is open (ARK balance must cover total). */
  enforceArkBalance: boolean;
}): CashierNfcAction {
  if (!input.memberFound) return "create";
  if (input.enforceArkBalance && input.balance < input.totalDue) return "topup";
  return "select";
}

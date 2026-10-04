export const CASH_FLOW_CATEGORIES = [
  "OPERATING",
  "INVESTING",
  "FINANCING",
  "NON_CASH",
] as const;

export type CashFlowCategory = (typeof CASH_FLOW_CATEGORIES)[number];

export const ACCOUNT_TYPE_CODES = [
  "ASSET",
  "LIABILITY",
  "EQUITY",
  "REVENUE",
  "COGS",
  "EXPENSE",
  "OTHER_INCOME",
  "OTHER_EXPENSE",
] as const;

export type AccountTypeCode = (typeof ACCOUNT_TYPE_CODES)[number];

export function isCashFlowCategory(
  value: string | null | undefined
): value is CashFlowCategory {
  return (
    value != null &&
    (CASH_FLOW_CATEGORIES as readonly string[]).includes(value)
  );
}

/**
 * Map compact code → account type for SULU seed/import heuristics.
 * Class 8 splits: subgroup starting with 2 → OTHER_INCOME, else OTHER_EXPENSE.
 */
export function inferAccountTypeCode(code: string): AccountTypeCode {
  const digit = code[0];
  switch (digit) {
    case "1":
      return "ASSET";
    case "2":
      return "LIABILITY";
    case "3":
      return "EQUITY";
    case "4":
      return "REVENUE";
    case "5":
      return "COGS";
    case "6":
    case "7":
      return "EXPENSE";
    case "8": {
      // 82xxxxx = non-operating income
      if (code.length >= 2 && code[1] === "2") return "OTHER_INCOME";
      return "OTHER_EXPENSE";
    }
    default:
      return "EXPENSE";
  }
}

/** Heuristic cash-flow category from code + name (headers usually null). */
export function inferCashFlowCategory(
  code: string,
  name: string,
  level: number
): CashFlowCategory | null {
  if (level < 4 && !/DEPRECIATION/i.test(name)) return null;

  const upper = name.toUpperCase();
  if (/DEPRECIATION|\bDE\b/.test(upper) || code.startsWith("81")) {
    return "NON_CASH";
  }

  if (code.startsWith("11") || code.startsWith("12") || code.startsWith("13")) {
    return "OPERATING";
  }
  if (code.startsWith("21")) return "OPERATING";
  if (code.startsWith("16") || code.startsWith("17")) return "INVESTING";
  if (code.startsWith("22") || code.startsWith("3")) return "FINANCING";
  if (code.startsWith("4") || code.startsWith("5") || code.startsWith("6")) {
    return "OPERATING";
  }
  if (code.startsWith("82")) return "OPERATING";
  if (code.startsWith("83")) return "OPERATING";

  return null;
}

export function inferIsContra(name: string): boolean {
  return /ACCUMULAT|ALLOWANCE FOR|CONTRA/i.test(name);
}

/** Heuristic: leaf kas/bank (kode 1101xxx / 1102xxx), bukan loan/bunga/AR. */
export function inferIsCashBank(
  name: string,
  code?: string,
  level?: number
): boolean {
  if (code && /^110[12]/.test(code)) {
    if (level != null) return level === 4;
    return !/000$/.test(code);
  }

  if (
    /LOAN|INTEREST|CHARGE|MDR|RECEIVABLE|\bAR\b|TAX|PPH|COMMISION|COMMISSION/i.test(
      name
    )
  ) {
    return false;
  }

  return /\bCASH\b|\bBANK\b|PETTY\s*CASH|\bGIRO\b|\bREKENING\b|\bKAS\b/i.test(
    name
  );
}

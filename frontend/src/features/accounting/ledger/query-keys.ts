export const subsidiaryKeys = {
  all: ["accounting", "subsidiary-ledger"] as const,
  parties: (kind: string) => [...subsidiaryKeys.all, "parties", kind] as const,
  ledger: (kind: string, partyKey: string, from: string, to: string) =>
    [...subsidiaryKeys.all, "ledger", kind, partyKey, from, to] as const,
};

export const reportsQueryKeys = {
  all: ["hris", "reports"] as const,
  report: (month: number, year: number) =>
    ["hris", "reports", month, year] as const,
};

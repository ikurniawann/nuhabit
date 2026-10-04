export const payrollQueryKeys = {
  all: ["hris", "payroll"] as const,
  runs: () => ["hris", "payroll", "runs"] as const,
  run: (id: string) => ["hris", "payroll", "run", id] as const,
  payslip: (payrollRunId: string, employeeId: string) =>
    ["hris", "payroll", "payslip", payrollRunId, employeeId] as const,
  settings: (taxYear?: number) =>
    ["hris", "payroll", "settings", taxYear ?? "current"] as const,
};

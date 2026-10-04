export const offboardingQueryKeys = {
  employee: (employeeId: string) =>
    ["hris", "offboarding", "employee", employeeId] as const,
  record: (employeeId: string) =>
    ["hris", "offboarding", "record", employeeId] as const,
};

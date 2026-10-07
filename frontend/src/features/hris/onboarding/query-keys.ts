export const onboardingQueryKeys = {
  employee: (employeeId: string) =>
    ["hris", "onboarding", "employee", employeeId] as const,
};

export const jobPortalQueryKeys = {
  all: ["hris", "job-portal"] as const,
  jobs: () => ["hris", "job-portal", "jobs"] as const,
  brands: () => ["hris", "job-portal", "brands"] as const,
  positions: () => ["hris", "job-portal", "positions"] as const,
  departments: () => ["hris", "job-portal", "departments"] as const,
};

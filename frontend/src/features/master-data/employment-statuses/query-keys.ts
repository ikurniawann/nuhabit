export const employmentStatusesQueryKeys = {
  all: ["master-data", "employment-statuses"] as const,
  list: () => ["master-data", "employment-statuses", "list"] as const,
};

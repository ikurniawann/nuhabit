export const departmentsQueryKeys = {
  all: ["master-data", "departments"] as const,
  list: () => ["master-data", "departments", "list"] as const,
};

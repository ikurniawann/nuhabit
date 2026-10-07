export const positionsQueryKeys = {
  all: ["master-data", "positions"] as const,
  list: () => ["master-data", "positions", "list"] as const,
};

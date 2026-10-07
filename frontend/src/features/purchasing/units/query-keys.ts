export interface UnitListParams {
  search?: string;
  page?: number;
  limit?: number;
}

export const unitsQueryKeys = {
  all: ["purchasing", "units"] as const,
  list: (params: UnitListParams) =>
    ["purchasing", "units", "list", params] as const,
};

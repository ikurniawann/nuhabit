"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { listUnits } from "@/lib/purchasing/api-client/units";
import { unitsQueryKeys, type UnitListParams } from "./query-keys";

export const useUnitList = (params: UnitListParams) =>
  useQuery({
    queryKey: unitsQueryKeys.list(params),
    queryFn: () => listUnits(params),
    placeholderData: keepPreviousData,
  });

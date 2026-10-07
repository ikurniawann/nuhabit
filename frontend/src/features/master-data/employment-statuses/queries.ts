"use client";

import { useQuery } from "@tanstack/react-query";
import { employmentStatusesQueryKeys } from "./query-keys";
import { fetchEmploymentStatusList } from "./api";

export const useEmploymentStatusList = () =>
  useQuery({
    queryKey: employmentStatusesQueryKeys.list(),
    queryFn: fetchEmploymentStatusList,
  });

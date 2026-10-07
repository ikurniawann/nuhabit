"use client";

import { useQuery } from "@tanstack/react-query";
import { departmentsQueryKeys } from "./query-keys";
import { fetchDepartmentList } from "./api";

export const useDepartmentList = () =>
  useQuery({
    queryKey: departmentsQueryKeys.list(),
    queryFn: fetchDepartmentList,
  });

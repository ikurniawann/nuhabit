"use client";

import { useQuery } from "@tanstack/react-query";
import { positionsQueryKeys } from "./query-keys";
import { fetchPositionList } from "./api";

export const usePositionList = () =>
  useQuery({
    queryKey: positionsQueryKeys.list(),
    queryFn: fetchPositionList,
  });

"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchShifts } from "./api";
import { shiftQueryKeys } from "./query-keys";

export const useShifts = () => useQuery({ queryKey: shiftQueryKeys.list(), queryFn: fetchShifts });

"use client";

import { useQuery } from "@tanstack/react-query";
import { logbookQueryKeys } from "./query-keys";
import {
  fetchLogbookMe,
  fetchLogbookDepartments,
  fetchLogbookTemplates,
  fetchLogbookEntries,
  fetchLogbookSummary,
} from "./api";
import type { LogbookEntriesParams, LogbookTemplatesParams } from "./types";

export const useLogbookMe = () =>
  useQuery({ queryKey: logbookQueryKeys.me(), queryFn: fetchLogbookMe });

export const useLogbookDepartments = () =>
  useQuery({ queryKey: logbookQueryKeys.departments(), queryFn: fetchLogbookDepartments });

export const useLogbookTemplates = (params?: LogbookTemplatesParams) =>
  useQuery({
    queryKey: logbookQueryKeys.templates(params),
    queryFn: () => fetchLogbookTemplates(params),
  });

export const useLogbookEntries = (params?: LogbookEntriesParams) =>
  useQuery({
    queryKey: logbookQueryKeys.entries(params),
    queryFn: () => fetchLogbookEntries(params),
  });

export const useLogbookSummary = (params?: { department_id?: string }) =>
  useQuery({
    queryKey: logbookQueryKeys.summary(params),
    queryFn: () => fetchLogbookSummary(params),
  });

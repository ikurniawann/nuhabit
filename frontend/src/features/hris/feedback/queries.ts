"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { feedbackQueryKeys } from "./query-keys";
import {
  fetchFeedbackApprovals,
  fetchFeedbackAssignments,
  fetchFeedbackCycles,
  fetchFeedbackSummaries,
  fetchMyFeedback,
  fetchMyFeedbackDetail,
} from "./api";
import type { FeedbackApprovalFilter } from "./types";

export const useFeedbackCycles = () =>
  useQuery({ queryKey: feedbackQueryKeys.cycles(), queryFn: fetchFeedbackCycles });

export const useFeedbackAssignments = (cycleId: string) =>
  useQuery({
    queryKey: feedbackQueryKeys.assignments(cycleId),
    queryFn: () => fetchFeedbackAssignments(cycleId),
    enabled: !!cycleId,
  });

export const useFeedbackApprovals = (status: FeedbackApprovalFilter) =>
  useQuery({
    queryKey: feedbackQueryKeys.approvals(status),
    queryFn: () => fetchFeedbackApprovals(status),
    placeholderData: keepPreviousData,
  });

export const useFeedbackSummaries = (cycleId: string) =>
  useQuery({
    queryKey: feedbackQueryKeys.summaries(cycleId),
    queryFn: () => fetchFeedbackSummaries(cycleId),
    enabled: !!cycleId,
  });

export const useMyFeedback = () => useQuery({ queryKey: feedbackQueryKeys.mine(), queryFn: fetchMyFeedback });

export const useMyFeedbackDetail = (id: string | null) =>
  useQuery({
    queryKey: feedbackQueryKeys.myDetail(id ?? ""),
    queryFn: () => fetchMyFeedbackDetail(id ?? ""),
    enabled: !!id,
  });

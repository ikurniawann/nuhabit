"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { feedbackQueryKeys } from "./query-keys";
import {
  createFeedbackAssignments,
  createFeedbackCycle,
  decideFeedback,
  deleteFeedbackAssignment,
  deleteFeedbackCycle,
  saveMyFeedback,
  updateFeedbackCycle,
} from "./api";
import type {
  FeedbackAssignmentPayload,
  FeedbackCyclePayload,
  FeedbackDecision,
  MyFeedbackSavePayload,
} from "./types";

/** Semua data 360 saling terkait (progres, antrean, hasil): segarkan sekaligus. */
function useFeedbackMutation<TVars, TResult>(mutationFn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => qc.invalidateQueries({ queryKey: feedbackQueryKeys.all }),
    retry: false,
  });
}

type SaveCycle = { id: null; payload: FeedbackCyclePayload } | { id: string; payload: Partial<FeedbackCyclePayload> };

export const useSaveFeedbackCycle = () =>
  useFeedbackMutation((vars: SaveCycle) =>
    vars.id === null ? createFeedbackCycle(vars.payload) : updateFeedbackCycle(vars.id, vars.payload)
  );

export const useDeleteFeedbackCycle = () => useFeedbackMutation((id: string) => deleteFeedbackCycle(id));

export const useCreateFeedbackAssignments = () =>
  useFeedbackMutation((rows: FeedbackAssignmentPayload[]) => createFeedbackAssignments(rows));

export const useDeleteFeedbackAssignment = () => useFeedbackMutation((id: string) => deleteFeedbackAssignment(id));

export const useDecideFeedback = () => useFeedbackMutation((decision: FeedbackDecision) => decideFeedback(decision));

export const useSaveMyFeedback = () =>
  useFeedbackMutation(({ id, payload }: { id: string; payload: MyFeedbackSavePayload }) => saveMyFeedback(id, payload));

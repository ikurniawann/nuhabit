"use client";

import { useQuery } from "@tanstack/react-query";
import type { TaskSubjectType } from "@/lib/sales-funnel/tasks";
import { fetchTimeline } from "./api";

export const timelineQueryKeys = {
  all: ["sales-funnel", "timeline"] as const,
  subject: (type: TaskSubjectType, id: string) => ["sales-funnel", "timeline", type, id] as const,
};

export const useRecordTimeline = (subjectType: TaskSubjectType, subjectId: string, enabled = true) =>
  useQuery({
    queryKey: timelineQueryKeys.subject(subjectType, subjectId),
    queryFn: () => fetchTimeline(subjectType, subjectId),
    enabled: enabled && subjectId !== "",
  });

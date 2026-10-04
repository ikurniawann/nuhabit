import type { TimelineEvent } from "@/lib/sales-funnel/timeline";
import type { TaskSubjectType } from "@/lib/sales-funnel/tasks";

export async function fetchTimeline(
  subjectType: TaskSubjectType,
  subjectId: string,
  limit = 100
): Promise<TimelineEvent[]> {
  const params = new URLSearchParams({ subject_type: subjectType, subject_id: subjectId, limit: String(limit) });
  const res = await fetch(`/api/sales-funnel/timeline?${params.toString()}`);
  if (!res.ok) {
    let message = "Gagal memuat timeline";
    try {
      const body = (await res.json()) as { error?: string };
      message = body.error ?? message;
    } catch {
      // bukan JSON
    }
    throw new Error(message);
  }
  const body = (await res.json()) as { data: TimelineEvent[] };
  return body.data;
}

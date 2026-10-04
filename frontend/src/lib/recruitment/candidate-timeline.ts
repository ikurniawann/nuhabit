export interface TimelineEntry {
  id: string;
  kind: "note" | "activity";
  text: string;
  author: string;
  at: string;
}

interface NoteLike {
  id: string;
  content: string;
  created_by_name?: string | null;
  created_at: string;
}

interface ActivityLike {
  id: string;
  activity_type: string;
  description: string;
  created_by_name?: string | null;
  created_at: string;
}

/** Dua timeline terpisah (tab): catatan HR dan aktivitas pipeline. */
export function buildCandidateTimelines(notes: NoteLike[], activities: ActivityLike[]) {
  return {
    noteEntries: notes.map(
      (n): TimelineEntry => ({
        id: `note-${n.id}`,
        kind: "note",
        text: n.content,
        author: n.created_by_name || "HR",
        at: n.created_at,
      })
    ),
    // note_added dilewati: isi catatannya sudah tampil di tab Catatan
    activityEntries: activities
      .filter((a) => a.activity_type !== "note_added")
      .map(
        (a): TimelineEntry => ({
          id: `act-${a.id}`,
          kind: "activity",
          text: a.description,
          author: a.created_by_name || "Sistem",
          at: a.created_at,
        })
      ),
  };
}

/** Hari sejak perubahan terakhir (dibulatkan ke atas, minimal 0). */
export const daysInStage = (updatedAt: string, now = Date.now()) =>
  Math.max(0, Math.ceil((now - new Date(updatedAt).getTime()) / 86_400_000));

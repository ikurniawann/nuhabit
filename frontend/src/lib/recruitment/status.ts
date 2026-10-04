import type { CandidateStatus, PipelineStage } from "@/types";

/**
 * Status pipeline recruitment (urutan = progres funnel).
 * talent_pool & rejected adalah terminal/parkir, bukan bagian funnel utama.
 */
export const PIPELINE_STAGES: {
  id: PipelineStage;
  label: string;
  /** warna kolom kanban */
  color: string;
  /** warna badge status */
  badge: string;
  /** bagian funnel utama (untuk progress) */
  funnel: boolean;
}[] = [
  { id: "applied", label: "Applied", color: "bg-blue-50 border-blue-300", badge: "bg-blue-100 text-blue-700", funnel: true },
  { id: "screening", label: "Screening", color: "bg-cyan-50 border-cyan-300", badge: "bg-cyan-100 text-cyan-700", funnel: true },
  { id: "psikotes", label: "Psikotes", color: "bg-violet-50 border-violet-300", badge: "bg-violet-100 text-violet-700", funnel: true },
  { id: "interview", label: "Interview", color: "bg-purple-50 border-purple-300", badge: "bg-purple-100 text-purple-700", funnel: true },
  { id: "offer", label: "Offer", color: "bg-amber-50 border-amber-300", badge: "bg-amber-100 text-amber-700", funnel: true },
  { id: "hired", label: "Hired", color: "bg-emerald-50 border-emerald-300", badge: "bg-emerald-100 text-emerald-700", funnel: true },
  { id: "talent_pool", label: "Talent Pool", color: "bg-pink-50 border-pink-300", badge: "bg-pink-100 text-pink-700", funnel: false },
  { id: "rejected", label: "Tolak", color: "bg-red-50 border-red-300", badge: "bg-red-100 text-red-700", funnel: false },
];

export const CANDIDATE_STATUS_LABELS: Record<CandidateStatus, string> = {
  applied: "Applied",
  screening: "Screening",
  psikotes: "Psikotes",
  interview: "Interview",
  offer: "Offer",
  hired: "Hired",
  talent_pool: "Talent Pool",
  rejected: "Tolak",
  archived: "Diarsipkan",
};

export const CANDIDATE_STATUS_BADGES: Record<CandidateStatus, string> = {
  applied: "bg-blue-100 text-blue-700",
  screening: "bg-cyan-100 text-cyan-700",
  psikotes: "bg-violet-100 text-violet-700",
  interview: "bg-purple-100 text-purple-700",
  offer: "bg-amber-100 text-amber-700",
  hired: "bg-emerald-100 text-emerald-700",
  talent_pool: "bg-pink-100 text-pink-700",
  rejected: "bg-red-100 text-red-700",
  archived: "bg-gray-100 text-gray-700",
};

/** Status yang dianggap masih aktif berjalan di pipeline. */
export const ACTIVE_PIPELINE_STATUSES: CandidateStatus[] = [
  "applied",
  "screening",
  "psikotes",
  "interview",
  "offer",
];

/** Urutan stage funnel utama, untuk hitung progress per kandidat. */
export const FUNNEL_ORDER: PipelineStage[] = PIPELINE_STAGES.filter((s) => s.funnel).map((s) => s.id);

/** Index progres 0..n dari sebuah status (talent_pool/rejected → -1). */
export function funnelIndex(status: string): number {
  return FUNNEL_ORDER.indexOf(status as PipelineStage);
}

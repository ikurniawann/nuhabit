import type { PipelineStage } from "@/types";
import { FUNNEL_ORDER, PIPELINE_STAGES, funnelIndex } from "./status";

/** Logika papan kanban pipeline: filter, kelompok per tahap, umur kartu. */

export interface BoardCandidate {
  id: string;
  full_name: string;
  email?: string | null;
  status: string;
  brand_id?: string | null;
  updated_at: string;
  positions?: { title: string } | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Hari di tahap saat ini (dibulatkan ke atas), dari updated_at. */
export function daysInStage(updatedAt: string, now: number = Date.now()): number {
  return Math.ceil(Math.abs(now - new Date(updatedAt).getTime()) / DAY_MS);
}

/** > 14 hari merah, > 7 hari kuning. */
export function stageAgeTone(days: number): "stale" | "aging" | "fresh" {
  if (days > 14) return "stale";
  if (days > 7) return "aging";
  return "fresh";
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function filterBoardCandidates<T extends BoardCandidate>(
  list: T[],
  brandId: string,
  search: string
): T[] {
  const q = search.trim().toLowerCase();
  return list.filter(
    (c) =>
      (brandId === "all" || c.brand_id === brandId) &&
      (!q ||
        c.full_name.toLowerCase().includes(q) ||
        Boolean(c.email?.toLowerCase().includes(q)) ||
        Boolean(c.positions?.title?.toLowerCase().includes(q)))
  );
}

export function groupByStage<T extends BoardCandidate>(list: T[]): Map<PipelineStage, T[]> {
  const map = new Map<PipelineStage, T[]>(PIPELINE_STAGES.map((s) => [s.id, []]));
  for (const c of list) map.get(c.status as PipelineStage)?.push(c);
  return map;
}

/** Jumlah kandidat di tahap funnel utama (tanpa talent pool / tolak). */
export const funnelTotal = (byStage: Map<PipelineStage, unknown[]>) =>
  FUNNEL_ORDER.reduce((acc, s) => acc + (byStage.get(s)?.length ?? 0), 0);

/** Lebar segmen bar funnel (%): min 4% bila ada isinya, rata bila funnel kosong. */
export function funnelSegmentWidth(count: number, total: number): number {
  if (total === 0) return 100 / FUNNEL_ORDER.length;
  return Math.max((count / total) * 100, count > 0 ? 4 : 0);
}

/** Tahap sebelum/sesudah di funnel; null di ujung atau bila parkir. */
export function neighbourStages(status: string): { prev: PipelineStage | null; next: PipelineStage | null } {
  const idx = funnelIndex(status);
  return {
    prev: idx > 0 ? FUNNEL_ORDER[idx - 1] : null,
    next: idx >= 0 && idx < FUNNEL_ORDER.length - 1 ? FUNNEL_ORDER[idx + 1] : null,
  };
}

export const stageMeta = (id: string) => PIPELINE_STAGES.find((s) => s.id === id) ?? null;

/** Warna titik/segmen: badge "bg-x-100" → "bg-x-400". */
export const stageDotClass = (badge: string) => badge.split(" ")[0].replace("100", "400");

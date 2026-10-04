export type SplitStatusLike = {
  status?: string | null;
};

export type ActiveSplitSummary = {
  total: number;
  paid: number;
  pending: number;
};

/** Non-cancelled splits on an order (for open-bill resume UX). */
export function getActiveSplitSummary(
  splits?: SplitStatusLike[] | null
): ActiveSplitSummary | null {
  const active = (splits || []).filter(
    (split) => String(split.status || "").toLowerCase() !== "cancelled"
  );
  if (active.length === 0) return null;

  const paid = active.filter(
    (split) => String(split.status || "").toLowerCase() === "paid"
  ).length;

  return {
    total: active.length,
    paid,
    pending: active.length - paid,
  };
}

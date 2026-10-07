export function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.min(100, Math.max(0, n)) * 100) / 100;
}

export function isPlaced(
  pos_x: number | null | undefined,
  pos_y: number | null | undefined
): boolean {
  return (
    pos_x != null &&
    pos_y != null &&
    Number.isFinite(pos_x) &&
    Number.isFinite(pos_y)
  );
}

/** Client-only initial layout for tables that have never been dragged. */
export function assignGridPositions(
  ids: string[],
  cols = 6
): Record<string, { pos_x: number; pos_y: number }> {
  if (!(cols > 0)) cols = 6;
  const out: Record<string, { pos_x: number; pos_y: number }> = {};
  const startX = 4;
  const startY = 4;
  // Keep steps wide enough that 96px nodes rarely overlap on ~700px+ canvases.
  const stepX = 18;
  const stepY = 20;
  ids.forEach((id, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    out[id] = {
      pos_x: clampPercent(startX + col * stepX),
      pos_y: clampPercent(startY + row * stepY),
    };
  });
  return out;
}

export type FloorNodePositionInput = {
  id: string;
  pos_x?: number | null;
  pos_y?: number | null;
};

/** Prefer saved coords; fall back to a local grid for unplaced tables. */
export function buildFloorNodePositions(
  tables: FloorNodePositionInput[],
  cols = 5
): Record<string, { x: number; y: number }> {
  const unplacedIds = tables
    .filter((t) => !isPlaced(t.pos_x, t.pos_y))
    .map((t) => t.id);
  const grid = assignGridPositions(unplacedIds, cols);
  const map: Record<string, { x: number; y: number }> = {};
  tables.forEach((t) => {
    if (isPlaced(t.pos_x, t.pos_y)) {
      map[t.id] = {
        x: clampPercent(t.pos_x as number),
        y: clampPercent(t.pos_y as number),
      };
    } else {
      const g = grid[t.id];
      map[t.id] = g ? { x: g.pos_x, y: g.pos_y } : { x: 4, y: 4 };
    }
  });
  return map;
}

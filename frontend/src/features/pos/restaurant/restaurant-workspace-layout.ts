/**
 * Restaurant floor + action rail. Same 8.7"/800px split as kasir — don't wait for `lg`.
 * Open Bills is a Sheet drawer (not a permanent third column).
 */

export function restaurantWorkspaceClass(immersive: boolean): string {
  const cols =
    "grid min-h-0 gap-3 min-[800px]:grid-cols-[148px_minmax(0,1fr)] min-[1100px]:grid-cols-[184px_minmax(0,1fr)]";
  if (immersive) {
    return `${cols} h-[calc(100dvh-4.5rem)] min-h-[520px]`;
  }
  return `${cols} min-h-[70vh] min-[800px]:h-[calc(100dvh-14rem)] min-[800px]:min-h-[480px]`;
}

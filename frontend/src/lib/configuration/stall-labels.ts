/** User-facing labels for configuration.warehouses (storage locations). */
export const STALL_LABELS = {
  singular: "Stall",
  plural: "Stalls",
  defaultName: "Main Storage",
  defaultCode: "MAIN",
  select: "Select stall",
  selectPlaceholder: "Select stall...",
  search: "Search stall...",
  empty: "No stall found",
  loading: "Loading stalls...",
  destination: "Destination Stall",
  allBranchTotal: "All Stalls (Branch Total)",
  perLocation: "stall location",
} as const;

export function isMainStorageCode(code: string): boolean {
  return code.trim().toUpperCase() === STALL_LABELS.defaultCode;
}

export function isStallCode(code: string): boolean {
  return /^STALL-0*\d+$/i.test(code.trim());
}

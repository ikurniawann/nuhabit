/**
 * Kasir product + cart split. Tablet-width dashboard (~8.7"/800px) must stay
 * side-by-side — Tailwind `lg` (1024) is too late and collapses the grid.
 */

export function cashierSplitRowClass(options: {
  isTabletMode: boolean;
  shellHeight: string;
}): string {
  if (options.isTabletMode) {
    return "flex min-h-0 flex-1 flex-row gap-3";
  }
  return `flex min-h-0 flex-col min-[800px]:flex-row ${options.shellHeight} gap-4`;
}

export function cashierCartPanelClass(isTabletMode: boolean): string {
  if (isTabletMode) {
    // Keranjang cukup lebar utk membaca item (keluhan owner 2026-09-29, tablet ±1024px).
    return "h-full max-h-none w-64 shrink-0 min-[900px]:w-80 min-[1100px]:w-[22rem] min-[1280px]:w-96";
  }
  return "max-h-[40vh] min-[800px]:max-h-none min-[800px]:h-full min-[800px]:w-64 min-[900px]:w-80 min-[1100px]:w-[22rem] lg:w-96";
}

export function cashierLeftPanelClass(isTabletMode: boolean): string {
  return isTabletMode
    ? "flex min-w-0 flex-1 flex-col overflow-hidden @container gap-2"
    : "flex min-w-0 flex-1 flex-col min-[800px]:overflow-hidden @container gap-4";
}

export function cashierProductScrollClass(): string {
  return "min-h-[240px] flex-1 overflow-y-auto";
}

export function cashierProductGridClass(): string {
  return "grid grid-cols-3 gap-2 @min-[28rem]:grid-cols-4 @min-[28rem]:gap-2.5 @min-[40rem]:grid-cols-5 @min-[40rem]:gap-3 @min-[52rem]:grid-cols-6 @min-[64rem]:grid-cols-7 @min-[80rem]:grid-cols-8";
}

/**
 * Known open axe violations the smoke spec tolerates. Rebuilt on 2026-10-19
 * from a strict walk (E2E_AXE_STRICT=1) of the merged build at phone, tablet
 * and desktop sizes in light and dark mode: every other rule passes on every
 * route. A violation of another rule, or of a listed rule on another route,
 * fails the smoke spec. Remove a route once its fix lands so the spec guards
 * it again.
 */
export type AllowedViolation = { rule: string; reason: string; routes: string[] };

export const AXE_ALLOWLIST: AllowedViolation[] = [
  {
    rule: "scrollable-region-focusable",
    reason: "Production tables scroll sideways on a phone without a keyboard stop; the production rework wraps them in ScrollRegion.",
    routes: [
      "/dashboard/items/product/production",
      "/dashboard/items/product/production/batches",
      "/dashboard/items/product/production/recipes",
      "/dashboard/items/product/production/wip",
      "/dashboard/items/raw-material/production",
      "/dashboard/items/raw-material/production/batches",
      "/dashboard/items/raw-material/production/recipes",
      "/dashboard/items/raw-material/production/wip",
      "/dashboard/purchasing/production",
      "/dashboard/purchasing/production/recipes",
    ],
  },
];

/** E2E_AXE_STRICT=1 ignores the list, to check which entries still match. */
export function isAllowed(rule: string, route: string): boolean {
  if (process.env.E2E_AXE_STRICT === "1") return false;
  return AXE_ALLOWLIST.some((entry) => entry.rule === rule && entry.routes.includes(route));
}

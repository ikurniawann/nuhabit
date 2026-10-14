/** The training section's pages, in the order the sub-navigation shows them. */
export const TRAINING_NAV = [
  { href: "/training", label: "Overview" },
  { href: "/training/block", label: "Training block" },
  { href: "/training/stations", label: "HYROX stations" },
  { href: "/training/coaches", label: "Coaches" },
  { href: "/training/timetable", label: "Timetable" },
  { href: "/training/faq", label: "FAQ" },
] as const;

type Named = { name: string; slug?: string };

/** The item's own slug, or one made from its name ("Race Sim" → "race-sim"). */
export function pageSlug(item: Named): string {
  return (item.slug || item.name).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** The item whose slug matches, with its position in the list. */
export function findBySlug<T extends Named>(items: T[], slug: string): { item: T | undefined; index: number } {
  const index = items.findIndex((item) => pageSlug(item) === slug);
  return { item: items[index], index };
}

export const classHref = (item: Named) => `/training/classes/${pageSlug(item)}`;
export const coachHref = (item: Named) => `/training/coaches/${pageSlug(item)}`;
export const stationHref = (item: Named) => `/training/stations/${pageSlug(item)}`;

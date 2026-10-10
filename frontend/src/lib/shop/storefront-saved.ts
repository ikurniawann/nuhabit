// Wishlist and recently viewed: pure list rules (no I/O).

export const RECENTLY_VIEWED_LIMIT = 8;

/** Move `id` to the front and keep the newest `limit` ids. */
export function pushRecentlyViewed(ids: string[], id: string, limit = RECENTLY_VIEWED_LIMIT): string[] {
  return [id, ...ids.filter((item) => item !== id)].slice(0, limit);
}

export function toggleSaved(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}

/**
 * The account list first, then the guest list's extra ids. Used once when a
 * member signs in, so saves made while browsing as a guest are kept.
 */
export function mergeWishlist(account: string[], local: string[]): string[] {
  const merged = [...account];
  for (const id of local) if (!merged.includes(id)) merged.push(id);
  return merged;
}

export const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id, index) => id === b[index]);

/** A stored id list; anything else reads as empty. */
export function parseIdList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

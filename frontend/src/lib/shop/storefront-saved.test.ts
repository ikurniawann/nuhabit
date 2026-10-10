import { describe, expect, it } from "vitest";
import { mergeWishlist, parseIdList, pushRecentlyViewed, sameIds, toggleSaved } from "./storefront-saved";

describe("storefront saved lists", () => {
  it("recently viewed keeps the newest first, no duplicates, at most 8", () => {
    let recent: string[] = [];
    for (const id of ["a", "b", "c", "d", "e", "f", "g", "h", "i"]) recent = pushRecentlyViewed(recent, id);
    expect(recent).toEqual(["i", "h", "g", "f", "e", "d", "c", "b"]);
    expect(pushRecentlyViewed(recent, "d")).toEqual(["d", "i", "h", "g", "f", "e", "c", "b"]);
  });

  it("toggles a saved id", () => {
    expect(toggleSaved([], "a")).toEqual(["a"]);
    expect(toggleSaved(["a", "b"], "a")).toEqual(["b"]);
  });

  it("merges the guest list into the account list without duplicates", () => {
    expect(mergeWishlist(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
    expect(sameIds(mergeWishlist(["a"], []), ["a"])).toBe(true);
    expect(sameIds(["a", "b"], ["b", "a"])).toBe(false);
  });

  it("reads a stored id list and treats anything else as empty", () => {
    expect(parseIdList('["a", 1, "b"]')).toEqual(["a", "b"]);
    expect(parseIdList("{bad")).toEqual([]);
    expect(parseIdList(null)).toEqual([]);
  });
});

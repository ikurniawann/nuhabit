import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { adoptAccountWishlist, bindSaved, pushRecent, resetSavedStore, toggleWishlist, useSaved } from "./saved-store";

describe("saved store", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetSavedStore();
  });

  it("keeps a guest's wishlist and recently viewed ids per slug in localStorage", () => {
    const { result } = renderHook(() => useSaved());
    act(() => bindSaved("store"));
    act(() => {
      toggleWishlist("p1");
      toggleWishlist("p2");
      pushRecent("p3");
      pushRecent("p1");
    });
    expect(result.current.wishlist).toEqual(["p1", "p2"]);
    expect(result.current.recent).toEqual(["p1", "p3"]);
    expect(JSON.parse(window.localStorage.getItem("shop-wishlist-store") ?? "")).toEqual(["p1", "p2"]);
    expect(JSON.parse(window.localStorage.getItem("shop-recent-store") ?? "")).toEqual(["p1", "p3"]);

    resetSavedStore();
    act(() => bindSaved("store"));
    expect(result.current.wishlist).toEqual(["p1", "p2"]);
  });

  it("merges the guest list into the account list once and stops writing it locally", () => {
    const { result } = renderHook(() => useSaved());
    act(() => bindSaved("store"));
    act(() => {
      toggleWishlist("p1");
    });
    let merged: { ids: string[]; changed: boolean } | undefined;
    act(() => {
      merged = adoptAccountWishlist(["p9"]);
    });
    expect(merged).toEqual({ ids: ["p9", "p1"], changed: true });
    expect(result.current.account).toBe(true);
    expect(window.localStorage.getItem("shop-wishlist-store")).toBeNull();

    act(() => {
      toggleWishlist("p2");
    });
    expect(result.current.wishlist).toEqual(["p9", "p1", "p2"]);
    expect(window.localStorage.getItem("shop-wishlist-store")).toBeNull();
    expect(adoptAccountWishlist(["p9", "p1", "p2"]).changed).toBe(false);
  });
});

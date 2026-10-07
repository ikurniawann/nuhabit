import { describe, expect, it } from "vitest";
import {
  EMPTY_WINDOW_REGISTRY,
  topWindowId,
  visibleWindowOrder,
  windowRegistryReducer as reduce,
  type WindowRegistryState,
} from "./window-registry";

function withWindows(...ids: string[]): WindowRegistryState {
  return ids.reduce((state, id) => reduce(state, { type: "register", id, title: id }), EMPTY_WINDOW_REGISTRY);
}

describe("windowRegistryReducer", () => {
  it("register menaruh jendela paling depan", () => {
    const state = withWindows("a", "b");
    expect(state.order).toEqual(["a", "b"]);
    expect(topWindowId(state)).toBe("b");
  });

  it("focus memindahkan ke depan dan memunculkan jendela yang dikecilkan", () => {
    let state = withWindows("a", "b");
    state = reduce(state, { type: "minimize", id: "a", value: true });
    state = reduce(state, { type: "focus", id: "a" });
    expect(state.order).toEqual(["b", "a"]);
    expect(state.windows.a.minimized).toBe(false);
  });

  it("focus pada jendela yang sudah di depan tidak mengubah state", () => {
    const state = withWindows("a", "b");
    expect(reduce(state, { type: "focus", id: "b" })).toBe(state);
  });

  it("minimize jendela teratas menyerahkan fokus ke bawahnya", () => {
    const state = reduce(withWindows("a", "b"), { type: "minimize", id: "b", value: true });
    expect(state.order).toEqual(["b", "a"]);
    expect(topWindowId(state)).toBe("a");
    expect(visibleWindowOrder(state)).toEqual(["a"]);
  });

  it("minimize jendela tak dikenal diabaikan", () => {
    const state = withWindows("a");
    expect(reduce(state, { type: "minimize", id: "x", value: true })).toBe(state);
  });

  it("release menghapus jendela dari urutan dan daftar", () => {
    const state = reduce(withWindows("a", "b"), { type: "release", id: "b" });
    expect(state.order).toEqual(["a"]);
    expect(state.windows.b).toBeUndefined();
    expect(reduce(state, { type: "release", id: "b" })).toBe(state);
  });

  it("register ulang mempertahankan status dikecilkan", () => {
    let state = reduce(withWindows("a", "b"), { type: "minimize", id: "a", value: true });
    state = reduce(state, { type: "register", id: "a", title: "A baru" });
    expect(state.windows.a).toEqual({ title: "A baru", minimized: false });
  });

  it("command memberi nonce baru setiap kali", () => {
    const first = reduce(EMPTY_WINDOW_REGISTRY, { type: "command", id: "a", kind: "maximize" });
    const second = reduce(first, { type: "command", id: "a", kind: "maximize" });
    expect(second.command?.nonce).toBe((first.command?.nonce ?? 0) + 1);
  });

  it("tanpa jendela terlihat → topWindowId null", () => {
    expect(topWindowId(EMPTY_WINDOW_REGISTRY)).toBeNull();
  });
});

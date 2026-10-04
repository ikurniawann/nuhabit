import { afterEach, describe, expect, it, vi } from "vitest";
import { prefersInputAutoFocus } from "./input-autofocus";

const mockPointer = (fine: boolean) =>
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(pointer: fine)" ? fine : !fine }));

afterEach(() => vi.unstubAllGlobals());

describe("prefersInputAutoFocus", () => {
  it("mouse/desktop → fokus otomatis", () => {
    mockPointer(true);
    expect(prefersInputAutoFocus()).toBe(true);
  });

  it("tablet/layar sentuh → tidak fokus (keyboard virtual tidak muncul)", () => {
    mockPointer(false);
    expect(prefersInputAutoFocus()).toBe(false);
  });
});

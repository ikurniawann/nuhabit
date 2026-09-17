import { act, render, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { THEME_STORAGE_KEY } from "@/lib/theme/theme-state";
import { ThemeProvider, useTheme, useThemeOrNull } from "./theme-provider";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider>{children}</ThemeProvider>
);

describe("useTheme", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("applies default theme to <html> on mount", () => {
    render(<ThemeProvider>x</ThemeProvider>);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(
      document.documentElement.style.getPropertyValue("--brand-primary")
    ).toBe("#1d1dcc");
  });

  it("setMode persists and updates the attribute", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => result.current.setMode("dark"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toContain("dark");
  });

  it("useThemeOrNull returns null outside ThemeProvider", () => {
    const { result } = renderHook(() => useThemeOrNull());
    expect(result.current).toBeNull();
  });
});

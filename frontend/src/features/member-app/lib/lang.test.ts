import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { setLang, syncAccountLang, useLang } from "./lang";

describe("member app language", () => {
  beforeEach(() => {
    localStorage.clear();
    // Module memory survives between tests; reset it to the default.
    setLang("id");
    localStorage.clear();
  });

  it("defaults to Indonesian on a fresh device", () => {
    const { result } = renderHook(() => useLang());
    expect(result.current).toBe("id");
  });

  it("follows the account language on a device that has not seen it", () => {
    const { result } = renderHook(() => useLang());
    act(() => syncAccountLang("EN"));
    expect(result.current).toBe("en");
    expect(localStorage.getItem("nuhabit.member.account-lang")).toBe("EN");
  });

  it("keeps a local choice until the account value changes", () => {
    const { result } = renderHook(() => useLang());
    act(() => syncAccountLang("ID"));
    act(() => setLang("en"));
    act(() => syncAccountLang("ID"));
    expect(result.current).toBe("en");

    act(() => syncAccountLang("EN"));
    act(() => setLang("id"));
    act(() => syncAccountLang("EN"));
    expect(result.current).toBe("id");

    act(() => syncAccountLang("ID"));
    expect(result.current).toBe("id");
  });

  it("reads an English choice stored before the default changed", () => {
    localStorage.setItem("nuhabit.member.lang", "en");
    const { result } = renderHook(() => useLang());
    expect(result.current).toBe("en");
  });
});

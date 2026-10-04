import { describe, expect, it } from "vitest";
import { readSessionToken } from "./constants";
import { readActiveStallCookie } from "./active-stall";

const jar = (values: Record<string, string>) => ({
  get: (name: string) => (name in values ? { value: values[name] } : undefined),
});

describe("readSessionToken", () => {
  it("memakai cookie baru bila ada", () => {
    expect(readSessionToken(jar({ nuhabit_session: "baru", arkiv_session: "lama" }))).toBe("baru");
  });
  it("jatuh ke cookie lama arkiv_session", () => {
    expect(readSessionToken(jar({ arkiv_session: "lama" }))).toBe("lama");
  });
  it("cookie baru kosong tidak menutupi cookie lama", () => {
    expect(readSessionToken(jar({ nuhabit_session: "", arkiv_session: "lama" }))).toBe("lama");
  });
  it("undefined tanpa cookie", () => {
    expect(readSessionToken(jar({}))).toBeUndefined();
  });
});

describe("readActiveStallCookie", () => {
  it("memakai cookie baru, lalu cookie lama", () => {
    expect(readActiveStallCookie(jar({ "nuhabit-active-stall": "all", "arkiv-active-stall": "x" }))).toBe("all");
    expect(readActiveStallCookie(jar({ "arkiv-active-stall": " abc " }))).toBe("abc");
    expect(readActiveStallCookie(jar({ "nuhabit-active-stall": "  " }))).toBeUndefined();
  });
});

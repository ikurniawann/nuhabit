import { describe, expect, it } from "vitest";
import { isPublicAuthPath } from "./middleware";

describe("Dataroom share: jalur publik tanpa login", () => {
  it("halaman & API link berbagi lolos tanpa sesi dashboard", () => {
    expect(isPublicAuthPath("/share/QfDCESXlANLPX81S4thhHoLTsMyvmEqm")).toBe(true);
    expect(isPublicAuthPath("/api/share/QfDCESXlANLPX81S4thhHoLTsMyvmEqm")).toBe(true);
    expect(isPublicAuthPath("/api/share/abc/files/123?download=1")).toBe(true);
  });

  it("API Dataroom internal tetap terlindungi", () => {
    expect(isPublicAuthPath("/api/dataroom/nodes")).toBe(false);
    expect(isPublicAuthPath("/dashboard/dataroom")).toBe(false);
  });
});

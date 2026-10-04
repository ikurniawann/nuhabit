import { describe, expect, it } from "vitest";
import { bucketAccess, randomFileToken } from "./storage";

describe("bucketAccess", () => {
  it("aset tampilan publik terbuka", () => {
    for (const b of ["products", "ticketing", "payment-qris", "desktop-wallpapers", "crm-announcements", "crm-avatars"]) {
      expect(bucketAccess(b)).toBe("public");
    }
  });
  it("dokumen kandidat dan bucket tak dikenal wajib staf; foto member milik pemilik", () => {
    expect(bucketAccess("cv")).toBe("staff");
    expect(bucketAccess("photos")).toBe("staff");
    expect(bucketAccess("candidates")).toBe("staff");
    expect(bucketAccess("apa-saja")).toBe("staff");
    expect(bucketAccess("member-photos")).toBe("member-owned");
  });
});

describe("randomFileToken", () => {
  it("128 bit hex dan tidak berulang", () => {
    const a = randomFileToken();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(randomFileToken()).not.toBe(a);
  });
});

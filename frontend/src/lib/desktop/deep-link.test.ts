import { describe, expect, it } from "vitest";
import { isPublicAuthPath } from "@/lib/auth/middleware";
import { OS_PATH, buildDeepLink, legacyOsRedirectTarget } from "./deep-link";

describe("rute desktop /os", () => {
  it("buildDeepLink menunjuk ke /os", () => {
    expect(buildDeepLink("/dashboard/pos/orders", "Transaksi")).toBe("/os?open=%2Fdashboard%2Fpos%2Forders&title=Transaksi");
  });

  it("/arkiv-os lama dialihkan ke /os dengan query utuh", () => {
    expect(legacyOsRedirectTarget({})).toBe(OS_PATH);
    expect(legacyOsRedirectTarget({ open: "/dashboard/crm", title: "CRM", x: undefined })).toBe("/os?open=%2Fdashboard%2Fcrm&title=CRM");
    expect(legacyOsRedirectTarget({ tag: ["a", "b"] })).toBe("/os?tag=a&tag=b");
  });

  it("/os dan /arkiv-os publik (mode tamu), tapi bukan awalan sembarang", () => {
    expect(isPublicAuthPath("/os")).toBe(true);
    expect(isPublicAuthPath("/arkiv-os")).toBe(true);
    expect(isPublicAuthPath("/osaka")).toBe(false);
  });
});

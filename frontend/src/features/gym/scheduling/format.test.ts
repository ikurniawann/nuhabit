import { describe, expect, it } from "vitest";
import { jam, rentangJam, waktu } from "./api";

describe("class times", () => {
  const start = "2026-10-24T11:00:00.000Z";
  const end = "2026-10-24T12:00:00.000Z";

  it("reads in the session's branch zone and names it outside WIB", () => {
    expect(jam(start)).toBe("18.00");
    expect(jam(start, "Asia/Makassar")).toBe("19.00 WITA");
    expect(rentangJam(start, end, "Asia/Jayapura")).toBe("20.00–21.00 WIT");
    expect(waktu(start, "Asia/Makassar")).toBe("Sab, 24 Okt, 19.00 WITA");
    expect(waktu(start)).toBe("Sab, 24 Okt, 18.00");
  });
});

import { describe, expect, it } from "vitest";
import { printQueueLevel, rollupStatus, statusLabel, type StatusItem } from "@/lib/desktop/status";

const item = (key: string, level: StatusItem["level"]): StatusItem => ({ key, label: key, level });

describe("rollupStatus", () => {
  it("mengambil kondisi terburuk, bukan mayoritas", () => {
    expect(rollupStatus([item("a", "ok"), item("b", "ok"), item("c", "down")])).toBe("down");
    expect(rollupStatus([item("a", "ok"), item("b", "warn")])).toBe("warn");
    expect(rollupStatus([item("a", "ok"), item("b", "unknown")])).toBe("unknown");
    expect(rollupStatus([item("a", "ok")])).toBe("ok");
  });
  it("tanpa item → belum diketahui (bukan 'normal')", () => {
    expect(rollupStatus([])).toBe("unknown");
    expect(statusLabel("unknown")).toMatch(/belum diketahui/i);
  });
});

describe("printQueueLevel", () => {
  it("antrian kosong normal; menumpuk = peringatan; tersangkut lama = mati", () => {
    expect(printQueueLevel(0, null)).toBe("ok");
    expect(printQueueLevel(3, 2)).toBe("ok");
    expect(printQueueLevel(12, 1)).toBe("warn");
    expect(printQueueLevel(2, 30)).toBe("down");
  });
});

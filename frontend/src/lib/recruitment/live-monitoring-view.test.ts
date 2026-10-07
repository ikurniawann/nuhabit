import { describe, expect, it } from "vitest";
import { elapsedLabel, isFrameStale, mergeChatMessages } from "./live-monitoring-view";

const NOW = Date.parse("2026-10-04T10:00:00Z");

describe("elapsedLabel", () => {
  it("menit lalu jam + menit", () => {
    expect(elapsedLabel("2026-10-04T09:48:00Z", NOW)).toBe("12 mnt");
    expect(elapsedLabel("2026-10-04T08:55:00Z", NOW)).toBe("1 jam 5 mnt");
  });

  it("kosong tanpa waktu mulai, tidak negatif", () => {
    expect(elapsedLabel(null, NOW)).toBe("");
    expect(elapsedLabel("2026-10-04T10:05:00Z", NOW)).toBe("0 mnt");
  });
});

describe("isFrameStale", () => {
  it("> 30 detik = basi", () => {
    expect(isFrameStale("2026-10-04T09:59:29Z", NOW)).toBe(true);
    expect(isFrameStale("2026-10-04T09:59:45Z", NOW)).toBe(false);
  });

  it("tanpa frame atau now belum diketahui = tidak basi", () => {
    expect(isFrameStale(null, NOW)).toBe(false);
    expect(isFrameStale("2026-10-04T09:00:00Z", 0)).toBe(false);
  });
});

describe("mergeChatMessages", () => {
  it("menambah pesan baru, mengabaikan duplikat", () => {
    const prev = [{ id: "a" }];
    expect(mergeChatMessages(prev, [{ id: "a" }, { id: "b" }])).toEqual([{ id: "a" }, { id: "b" }]);
  });

  it("referensi sama bila tidak ada yang baru", () => {
    const prev = [{ id: "a" }];
    expect(mergeChatMessages(prev, [{ id: "a" }])).toBe(prev);
  });
});

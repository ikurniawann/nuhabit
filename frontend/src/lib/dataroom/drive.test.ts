import { describe, expect, it } from "vitest";
import {
  activityLabel, atLeast, baseName, canPreview, chunkRanges, moveFocus, normalizeFolderPath, parentPath,
  planFolderUpload, previewKind, purgeDaysLeft, sortItems, usesChunkedUpload,
} from "./drive";

const item = (name: string, kind: "folder" | "file", size = 0, updated = "2026-10-01T00:00:00Z", owner: string | null = null) =>
  ({ id: name, name, kind, size_bytes: size, updated_at: updated, created_by_name: owner });

describe("sortItems", () => {
  const items = [
    item("b.txt", "file", 10, "2026-10-03T00:00:00Z", "Budi"),
    item("Zeta", "folder"),
    item("a.txt", "file", 30, "2026-10-01T00:00:00Z", "Ani"),
    item("alpha", "folder"),
    item("File 10.txt", "file", 20, "2026-10-02T00:00:00Z", "Cici"),
    item("File 9.txt", "file", 5, "2026-10-04T00:00:00Z", "Dedi"),
  ];

  it("folder dulu lalu nama (numerik, tanpa peduli huruf besar)", () => {
    expect(sortItems(items, "name", "asc").map((i) => i.name)).toEqual(["alpha", "Zeta", "a.txt", "b.txt", "File 9.txt", "File 10.txt"]);
    expect(sortItems(items, "name", "desc").map((i) => i.name)).toEqual(["Zeta", "alpha", "File 10.txt", "File 9.txt", "b.txt", "a.txt"]);
  });

  it("ukuran, tanggal dan pemilik; folder tetap di depan", () => {
    expect(sortItems(items, "size", "desc").map((i) => i.name)).toEqual(["alpha", "Zeta", "a.txt", "File 10.txt", "b.txt", "File 9.txt"]);
    expect(sortItems(items, "updated", "asc").map((i) => i.name).slice(2)).toEqual(["a.txt", "File 10.txt", "b.txt", "File 9.txt"]);
    expect(sortItems(items, "owner", "asc").map((i) => i.name).slice(2)).toEqual(["a.txt", "b.txt", "File 10.txt", "File 9.txt"]);
    expect(items[0].name).toBe("b.txt");
  });
});

describe("folder upload plan", () => {
  const file = (name: string) => new File(["x"], name);

  it("menormalkan path dan mengurutkan folder induk sebelum anak", () => {
    expect(normalizeFolderPath("./Laporan\\2026/")).toBe("Laporan/2026");
    expect(normalizeFolderPath("../rahasia")).toBe("rahasia");
    const plan = planFolderUpload([
      { file: file("a.pdf"), path: "Laporan/2026" },
      { file: file("b.pdf"), path: "Laporan" },
      { file: file("c.pdf"), path: "" },
      { file: file("d.pdf"), path: "Laporan/2026/Q1" },
    ]);
    expect(plan.folders).toEqual(["Laporan", "Laporan/2026", "Laporan/2026/Q1"]);
    expect([...plan.byFolder.keys()]).toEqual(["Laporan/2026", "Laporan", "", "Laporan/2026/Q1"]);
    expect(plan.byFolder.get("")?.map((f) => f.name)).toEqual(["c.pdf"]);
    expect(parentPath("Laporan/2026/Q1")).toBe("Laporan/2026");
    expect(parentPath("Laporan")).toBe("");
    expect(baseName("Laporan/2026/Q1")).toBe("Q1");
  });
});

describe("chunks and focus", () => {
  it("memotong file ke rentang byte", () => {
    expect(chunkRanges(10, 4)).toEqual([[0, 4], [4, 8], [8, 10]]);
    expect(chunkRanges(4, 4)).toEqual([[0, 4]]);
    expect(chunkRanges(0, 4)).toEqual([]);
    expect(usesChunkedUpload(101, 100)).toBe(true);
    expect(usesChunkedUpload(100, 100)).toBe(false);
  });

  it("navigasi panah di grid dan daftar", () => {
    expect(moveFocus(-1, "ArrowDown", 10, 4)).toBe(0);
    expect(moveFocus(0, "ArrowRight", 10, 4)).toBe(1);
    expect(moveFocus(1, "ArrowDown", 10, 4)).toBe(5);
    expect(moveFocus(9, "ArrowDown", 10, 4)).toBe(9);
    expect(moveFocus(5, "ArrowUp", 10, 4)).toBe(1);
    expect(moveFocus(0, "ArrowLeft", 10, 4)).toBe(0);
    expect(moveFocus(3, "ArrowDown", 10, 1)).toBe(4);
    expect(moveFocus(3, "End", 10, 1)).toBe(9);
    expect(moveFocus(3, "Home", 10, 1)).toBe(0);
    expect(moveFocus(3, "x", 10, 1)).toBe(3);
    expect(moveFocus(3, "ArrowDown", 0, 1)).toBe(-1);
  });
});

describe("preview kinds and labels", () => {
  it("memetakan MIME ke jenis pratinjau", () => {
    expect(previewKind("image/png")).toBe("image");
    expect(previewKind("application/pdf")).toBe("pdf");
    expect(previewKind("video/mp4")).toBe("video");
    expect(previewKind("audio/mpeg")).toBe("audio");
    expect(previewKind("text/markdown")).toBe("text");
    expect(previewKind("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("office");
    expect(previewKind("application/zip")).toBe("none");
    expect(canPreview("image/svg+xml")).toBe(false);
    expect(canPreview("text/csv")).toBe(true);
  });

  it("label aktivitas, peran dan sisa hari sampah", () => {
    expect(activityLabel("upload")).toBe("mengunggah");
    expect(activityLabel("misterius")).toBe("misterius");
    expect(atLeast("editor", "commenter")).toBe(true);
    expect(atLeast("viewer", "editor")).toBe(false);
    expect(atLeast(undefined, "viewer")).toBe(false);
    const now = Date.parse("2026-10-26T00:00:00Z");
    expect(purgeDaysLeft("2026-10-20T00:00:00Z", now)).toBe(24);
    expect(purgeDaysLeft("2026-09-01T00:00:00Z", now)).toBe(0);
    expect(purgeDaysLeft(null, now)).toBe(0);
  });
});

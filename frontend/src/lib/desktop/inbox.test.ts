import { describe, expect, it } from "vitest";
import {
  allowedInboxSections,
  describeLeaveRange,
  totalInboxCount,
  type InboxSection,
} from "@/lib/desktop/inbox";

describe("allowedInboxSections", () => {
  it("role penuh melihat semua seksi", () => {
    expect(allowedInboxSections("super_admin", [])).toEqual(["cuti", "po", "stok"]);
  });
  it("HR hanya cuti; gudang hanya PO & stok", () => {
    expect(allowedInboxSections("hrd", ["hris.workforce.leaves"])).toEqual(["cuti"]);
    const gudang = allowedInboxSections("staff", [
      "items.raw-material.approval.po",
      "items.raw-material.inventory.stock",
    ]);
    expect(gudang).toContain("po");
    expect(gudang).toContain("stok");
    expect(gudang).not.toContain("cuti");
  });
  it("tanpa menu → tidak ada seksi", () => {
    expect(allowedInboxSections("staff", [])).toEqual([]);
  });
});

describe("totalInboxCount", () => {
  it("menjumlahkan TOTAL seksi, bukan hanya item yang ditampilkan", () => {
    const sections: InboxSection[] = [
      { key: "cuti", label: "Cuti", total: 12, items: [] },
      { key: "po", label: "PO", total: 3, items: [] },
    ];
    expect(totalInboxCount(sections)).toBe(15);
  });
});

describe("describeLeaveRange", () => {
  it("tanggal sama tidak ditulis dua kali", () => {
    expect(describeLeaveRange("2026-09-18", "2026-09-18", 1)).toBe("1 hari · 18 Sep");
  });
  it("rentang ditulis singkat", () => {
    expect(describeLeaveRange("2026-09-18", "2026-09-20", 3)).toBe("3 hari · 18 Sep–20 Sep");
  });
});

import { describe, expect, it } from "vitest";
import {
  actionLabel,
  canTransition,
  categoryFromCs,
  complaintSlaState,
  complaintCode,
  complaintDeadlines,
  complaintTitle,
  defaultComplaintPriority,
  isComplaintOpen,
  nextStatuses,
  normalizeSlaRules,
  transitionNeedsNote,
} from "./complaints";

describe("complaintDeadlines", () => {
  const t0 = new Date("2026-10-22T02:00:00Z");

  it("cedera: respons 2 jam, selesai 24 jam", () => {
    const d = complaintDeadlines("injury", t0);
    expect(d.respondBy.toISOString()).toBe("2026-10-22T04:00:00.000Z");
    expect(d.resolveBy.toISOString()).toBe("2026-10-23T02:00:00.000Z");
  });

  it("lainnya: respons 24 jam, selesai 3 hari", () => {
    const d = complaintDeadlines("coach", t0);
    expect(d.respondBy.toISOString()).toBe("2026-10-23T02:00:00.000Z");
    expect(d.resolveBy.toISOString()).toBe("2026-10-25T02:00:00.000Z");
  });
});

describe("aturan kecil tiket", () => {
  it("prioritas awal cedera = tinggi", () => {
    expect(defaultComplaintPriority("injury")).toBe("high");
    expect(defaultComplaintPriority("facility")).toBe("normal");
  });

  it("kategori WA: pembayaran → billing, sisanya Lainnya", () => {
    expect(categoryFromCs("pembayaran")).toBe("billing");
    expect(categoryFromCs("layanan")).toBe("other");
    expect(categoryFromCs(null)).toBe("other");
  });

  it("terbuka = diterima / ditangani", () => {
    expect(isComplaintOpen("received")).toBe(true);
    expect(isComplaintOpen("in_progress")).toBe(true);
    expect(isComplaintOpen("resolved")).toBe(false);
    expect(isComplaintOpen("cancelled")).toBe(false);
  });

  it("kode per bulan WIB", () => {
    expect(complaintCode(new Date("2026-10-31T18:00:00Z"), 7)).toBe("KEL-2611-0007"); // 1 Nov 01.00 WIB
    expect(complaintCode(new Date("2026-10-22T02:00:00Z"), 123)).toBe("KEL-2610-0123");
  });

  it("judul: isian staf, lalu potongan deskripsi, lalu default kategori", () => {
    expect(complaintTitle("  AC ruang 2 mati ", null, "facility")).toBe("AC ruang 2 mati");
    expect(complaintTitle("", "Coach datang terlambat 20 menit dan kelas jadi molor sampai jam 8 lewat, member kecewa sekali", "coach")).toMatch(/…$/);
    expect(complaintTitle(null, null, "billing")).toBe("Keluhan billing");
  });
});

describe("alur status (B2)", () => {
  it("perpindahan sah dan wajib catatan", () => {
    expect(canTransition("received", "in_progress")).toBe(true);
    expect(canTransition("in_progress", "received")).toBe(false);
    expect(canTransition("resolved", "in_progress")).toBe(true);
    expect(canTransition("confirmed", "in_progress")).toBe(false);
    expect(nextStatuses("cancelled")).toEqual([]);
    expect(transitionNeedsNote("in_progress", "resolved")).toBe(true);
    expect(transitionNeedsNote("received", "cancelled")).toBe(true);
    expect(transitionNeedsNote("resolved", "in_progress")).toBe(true);
    expect(transitionNeedsNote("received", "in_progress")).toBe(false);
    expect(actionLabel("resolved", "in_progress")).toBe("Buka lagi");
    expect(actionLabel("received", "in_progress")).toBe("Mulai tangani");
  });

  it("status SLA: respons terpenuhi saat mulai ditangani; tiket tertutup selalu ok", () => {
    const now = new Date("2026-10-22T10:00:00Z");
    const base = { respond_by: "2026-10-22T09:00:00Z", resolve_by: "2026-10-23T09:00:00Z", first_response_at: null };
    expect(complaintSlaState({ ...base, status: "received" }, now)).toBe("respond_overdue");
    expect(complaintSlaState({ ...base, status: "in_progress", first_response_at: "2026-10-22T08:30:00Z" }, now)).toBe("ok");
    expect(complaintSlaState({ ...base, status: "in_progress", first_response_at: "x", resolve_by: "2026-10-22T09:30:00Z" }, now)).toBe("resolve_overdue");
    expect(complaintSlaState({ ...base, status: "resolved" }, now)).toBe("ok");
  });

  it("aturan SLA: sebagian ditimpa, nilai rusak diabaikan, selesai ≥ respons", () => {
    const r = normalizeSlaRules({ injury: { respond_hours: 1 }, coach: { respond_hours: 48, resolve_hours: 24 }, other: { respond_hours: "x" } });
    expect(r.injury).toEqual({ respond_hours: 1, resolve_hours: 24 });
    expect(r.coach).toEqual({ respond_hours: 48, resolve_hours: 48 });
    expect(r.other).toEqual({ respond_hours: 24, resolve_hours: 72 });
    expect(normalizeSlaRules(null).billing).toEqual({ respond_hours: 24, resolve_hours: 72 });
  });
});

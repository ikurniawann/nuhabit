import { describe, expect, it } from "vitest";
import {
  memberReportPriority,
  memberStatusLabel,
  newMemberReportMessage,
  actionLabel,
  canTransition,
  categoryFromCs,
  complaintSlaState,
  complaintCode,
  complaintDeadlines,
  complaintEscalationMessage,
  complaintTitle,
  defaultComplaintPriority,
  dueEscalations,
  escalationSendableNow,
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

describe("eskalasi (B3)", () => {
  const now = new Date("2026-10-22T10:00:00Z");
  const base = {
    status: "received" as const,
    respond_by: "2026-10-22T09:00:00Z",
    resolve_by: "2026-10-23T09:00:00Z",
    first_response_at: null,
    respond_escalated_at: null,
    resolve_escalated_at: null,
  };

  it("respons lewat & belum ditangani → eskalasi respons sekali", () => {
    expect(dueEscalations(base, now)).toEqual(["respond"]);
    expect(dueEscalations({ ...base, respond_escalated_at: "x" }, now)).toEqual([]);
    expect(dueEscalations({ ...base, first_response_at: "2026-10-22T09:30:00Z" }, now)).toEqual([]);
  });

  it("selesai lewat → eskalasi selesai; tiket tertutup tidak dieskalasi", () => {
    const late = { ...base, status: "in_progress" as const, first_response_at: "x", resolve_by: "2026-10-22T09:30:00Z" };
    expect(dueEscalations(late, now)).toEqual(["resolve"]);
    expect(dueEscalations({ ...base, resolve_by: "2026-10-22T09:30:00Z" }, now)).toEqual(["respond", "resolve"]);
    expect(dueEscalations({ ...late, status: "resolved" }, now)).toEqual([]);
  });

  it("jam tenang: hanya cedera / prioritas tinggi yang dikirim malam", () => {
    const night = new Date("2026-10-22T16:00:00Z"); // 23.00 WIB
    expect(escalationSendableNow(night, { category: "facility", priority: "normal" })).toBe(false);
    expect(escalationSendableNow(night, { category: "injury", priority: "normal" })).toBe(true);
    expect(escalationSendableNow(night, { category: "billing", priority: "urgent" })).toBe(true);
    expect(escalationSendableNow(now, { category: "facility", priority: "low" })).toBe(true); // 17.00 WIB
  });

  it("pesan eskalasi memuat kode, jenis, PIC, dan tautan", () => {
    const msg = complaintEscalationMessage({
      kind: "respond", code: "KEL-2610-0007", title: "AC ruang 2 mati", category: "facility", priority: "high",
      reporter: "Maya", coach: null, assignee: null, deadline: "2026-10-22T09:00:00Z", url: "https://x/dashboard/studio/complaints",
    });
    expect(msg).toContain("Keluhan belum ditangani");
    expect(msg).toContain("KEL-2610-0007 · Fasilitas · Tinggi");
    expect(msg).toContain("PIC: belum ada");
    expect(msg).toContain("https://x/dashboard/studio/complaints");
    expect(msg).not.toContain("Coach:");
  });
});

describe("laporan dari Member App (B4)", () => {
  it("status untuk member: dua status tutup jadi Closed", () => {
    expect(memberStatusLabel("received")).toBe("Received");
    expect(memberStatusLabel("in_progress")).toBe("In progress");
    expect(memberStatusLabel("resolved")).toBe("Resolved — please confirm");
    expect(memberStatusLabel("confirmed")).toBe("Closed");
    expect(memberStatusLabel("cancelled")).toBe("Closed");
  });

  it("prioritas: masukan selalu rendah, keluhan cedera tinggi", () => {
    expect(memberReportPriority("feedback", "injury")).toBe("low");
    expect(memberReportPriority("complaint", "injury")).toBe("high");
    expect(memberReportPriority("complaint", "facility")).toBe("normal");
  });

  it("WA staf: judul sesuai jenis, isi dipotong, baris kosong dibuang", () => {
    const base = { code: "KEL-2610-0009", category: "injury" as const, member: "Maya", session: "Hyrox 22/10 07:00", coach: "Coach Pras", url: "https://x/c" };
    const injury = newMemberReportMessage({ ...base, kind: "complaint", message: "Lutut  sakit\nsetelah sled push" });
    expect(injury).toContain("🚑 *Laporan cedera dari Member App*");
    expect(injury).toContain('"Lutut sakit setelah sled push"');
    expect(injury).toContain("Coach: Coach Pras");
    const fb = newMemberReportMessage({ ...base, kind: "feedback", category: "coach", session: null, coach: null, message: "x".repeat(400) });
    expect(fb).toContain("💬 *Masukan baru dari Member App*");
    expect(fb).not.toContain("Sesi:");
    expect(fb).toContain(`${"x".repeat(297)}…`);
  });
});

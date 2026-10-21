import { describe, expect, it } from "vitest";
import {
  approverNewLeaveMessage,
  canDirectorDecide,
  canRequestSubstitute,
  coverBlockers,
  isCoverResolved,
  rankSubstitutes,
  sessionStartAt,
  substituteRequestMessage,
  substituteRespondBy,
  type CoverStatus,
  type SubstituteCandidate,
} from "./coach-cover";

describe("status pengganti", () => {
  it("hanya accepted/assigned/cancel yang tertangani; void tidak menghalangi", () => {
    const all: CoverStatus[] = ["open", "requested", "accepted", "assigned", "cancel", "void"];
    expect(all.filter(isCoverResolved)).toEqual(["accepted", "assigned", "cancel"]);
    expect(coverBlockers(all.map((status) => ({ status }))).map((c) => c.status)).toEqual(["open", "requested"]);
  });

  it("coach hanya meminta untuk sesi open; PD boleh memutus semua kecuali void", () => {
    expect(canRequestSubstitute("open")).toBe(true);
    expect(canRequestSubstitute("requested")).toBe(false);
    expect(canRequestSubstitute("assigned")).toBe(false);
    expect(canDirectorDecide("accepted")).toBe(true);
    expect(canDirectorDecide("void")).toBe(false);
  });
});

describe("substituteRespondBy", () => {
  const now = new Date("2026-10-21T03:00:00Z"); // 10.00 WIB

  it("N jam dari sekarang bila sesi masih jauh", () => {
    const start = sessionStartAt("2026-10-28", "07:00");
    expect(substituteRespondBy(now, 24, start).toISOString()).toBe("2026-10-22T03:00:00.000Z");
  });

  it("tidak melewati 1 jam sebelum sesi", () => {
    const start = sessionStartAt("2026-10-21", "18:00"); // 11.00Z
    expect(substituteRespondBy(now, 24, start).toISOString()).toBe("2026-10-21T10:00:00.000Z");
  });

  it("sesi < 1 jam lagi → 15 menit", () => {
    const start = sessionStartAt("2026-10-21", "10:30");
    expect(substituteRespondBy(now, 24, start).toISOString()).toBe("2026-10-21T03:15:00.000Z");
  });
});

describe("rankSubstitutes", () => {
  const c = (coach_id: string, o: Partial<SubstituteCandidate> = {}): SubstituteCandidate => ({
    coach_id, name: coach_id, clash: false, on_leave: false, teaches_program: false, week_load: 0, ...o,
  });

  it("membuang bentrok & cuti; program dulu, lalu beban paling ringan, lalu nama", () => {
    const ranked = rankSubstitutes(
      [c("dina", { week_load: 2 }), c("budi", { clash: true }), c("ayu", { teaches_program: true, week_load: 5 }), c("cici", { on_leave: true }), c("bayu", { week_load: 2 })],
      "class"
    );
    expect(ranked.map((r) => r.coach_id)).toEqual(["ayu", "bayu", "dina"]);
  });

  it("Personal Training hanya coach yang membawakan program itu", () => {
    expect(rankSubstitutes([c("a"), c("b", { teaches_program: true })], "pt").map((r) => r.coach_id)).toEqual(["b"]);
  });
});

describe("pesan WA pengganti", () => {
  it("permintaan memuat sesi, peminta, batas waktu, dan link portal", () => {
    const msg = substituteRequestMessage({
      substituteName: "Coach Rara",
      requesterName: "Coach Pras",
      session: { program_name: "Hyrox Engine", session_date: "2026-11-02", start_time: "07:00" },
      respondBy: new Date("2026-10-22T03:00:00Z"),
      portalUrl: "https://nuhabitdev.reddie.id/coach?tab=leave",
    });
    expect(msg).toContain("Coach Pras");
    expect(msg).toContain("Hyrox Engine");
    expect(msg).toMatch(/2 Nov 07:00/);
    expect(msg).toContain("https://nuhabitdev.reddie.id/coach?tab=leave");
  });

  it("cuti mendadak ditandai di judul pesan ke approver", () => {
    const base = { approverName: "PD", coachName: "Coach Pras", leaveLabel: "Sakit", range: "21 Okt", sessions: 2, backofficeUrl: "x" };
    expect(approverNewLeaveMessage({ ...base, shortNotice: true })).toContain("CUTI MENDADAK");
    expect(approverNewLeaveMessage({ ...base, shortNotice: false })).toContain("Sesi terdampak: 2");
  });
});

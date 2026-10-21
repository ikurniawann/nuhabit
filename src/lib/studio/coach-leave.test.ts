import { describe, expect, it } from "vitest";
import { canDecideCoachLeave, resolveLeaveApprovers, type ApproverCandidate } from "./coach-leave";

const pd = (userId: string, onLeave = false): ApproverCandidate => ({ userId, name: userId.toUpperCase(), onLeave });

describe("resolveLeaveApprovers", () => {
  it("memakai semua Program Director yang tidak cuti", () => {
    const r = resolveLeaveApprovers({ programDirectors: [pd("a"), pd("b", true), pd("c")], backup: pd("z") });
    expect(r.source).toBe("program_director");
    expect(r.approvers.map((a) => a.userId)).toEqual(["a", "c"]);
  });

  it("jatuh ke approver cadangan saat semua Program Director cuti", () => {
    const r = resolveLeaveApprovers({ programDirectors: [pd("a", true)], backup: pd("z") });
    expect(r).toEqual({ approvers: [pd("z")], source: "backup" });
  });

  it("jatuh ke cadangan saat belum ada Program Director", () => {
    expect(resolveLeaveApprovers({ programDirectors: [], backup: pd("z") }).source).toBe("backup");
  });

  it("Program Director tidak memutus cutinya sendiri", () => {
    const r = resolveLeaveApprovers({ programDirectors: [pd("a")], backup: pd("z"), requesterUserId: "a" });
    expect(r).toEqual({ approvers: [pd("z")], source: "backup" });
  });

  it("hanya Super Admin bila cadangan juga cuti, kosong, atau pengaju", () => {
    expect(resolveLeaveApprovers({ programDirectors: [pd("a", true)], backup: pd("z", true) }).source).toBe("super_admin");
    expect(resolveLeaveApprovers({ programDirectors: [], backup: null })).toEqual({ approvers: [], source: "super_admin" });
    expect(resolveLeaveApprovers({ programDirectors: [], backup: pd("z"), requesterUserId: "z" }).source).toBe("super_admin");
  });
});

describe("canDecideCoachLeave", () => {
  const resolved = resolveLeaveApprovers({ programDirectors: [pd("a")], backup: pd("z") });

  it("approver yang ter-resolve boleh memutus", () => {
    expect(canDecideCoachLeave({ id: "a", role: "program_director" }, resolved)).toBe(true);
  });

  it("cadangan tidak memutus selama ada Program Director aktif", () => {
    expect(canDecideCoachLeave({ id: "z", role: "admin" }, resolved)).toBe(false);
  });

  it("admin biasa tidak memutus; Super Admin selalu boleh menggantikan", () => {
    expect(canDecideCoachLeave({ id: "x", role: "admin" }, resolved)).toBe(false);
    expect(canDecideCoachLeave({ id: "s", role: "super_admin" }, resolved)).toBe(true);
  });

  it("tidak ada yang memutus pengajuannya sendiri, termasuk Super Admin", () => {
    expect(canDecideCoachLeave({ id: "a", role: "program_director" }, resolved, "a")).toBe(false);
    expect(canDecideCoachLeave({ id: "s", role: "super_admin" }, resolved, "s")).toBe(false);
  });
});

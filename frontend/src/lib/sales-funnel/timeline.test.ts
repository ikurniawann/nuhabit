import { describe, expect, test } from "vitest";
import { groupByDay, mergeTimeline, normalizeTasks } from "./timeline";

describe("timeline terpadu (EPIC-050 T-1.4)", () => {
  test("gabung semua sumber, urut terbaru dulu, dedup by key", () => {
    const events = mergeTimeline({
      tasks: [
        {
          id: "t1",
          activity_type: "tugas",
          title: "Kirim proposal",
          notes: null,
          due_at: "2026-09-10T02:00:00Z",
          done_at: null,
          status: "open",
          priority: "high",
          created_at: "2026-09-01T00:00:00Z",
          owner_name: "Ani",
        },
        // duplikat key harus dibuang
        {
          id: "t1",
          activity_type: "tugas",
          title: "Kirim proposal",
          notes: null,
          due_at: "2026-09-10T02:00:00Z",
          done_at: null,
          status: "open",
          priority: "high",
          created_at: "2026-09-01T00:00:00Z",
          owner_name: "Ani",
        },
      ],
      stages: [
        { id: "s1", deal_id: "d1", deal_title: "Gathering", stage_name: "Nego", entered_at: "2026-09-12T03:00:00Z" },
      ],
      quotations: [
        { id: "q1", deal_id: "d1", quote_number: "Q-001", status: "draft", total: 1500000, created_at: "2026-09-11T03:00:00Z" },
      ],
      invoices: [],
      waMessages: [
        { id: "w1", direction: "inbound", body: "Halo, boleh minta penawaran?", status: "read", created_at: "2026-09-09T01:00:00Z" },
      ],
    });
    expect(events.map((e) => e.key)).toEqual(["stage:s1", "quotation:q1", "task:t1", "wa:w1"]);
    expect(events[1].title).toContain("Rp1.500.000");
    expect(events[3].title).toBe("WA masuk");
  });

  test("task selesai diurutkan pada done_at; aktivitas tanpa title memakai label jenis", () => {
    const [done, call] = normalizeTasks([
      {
        id: "a",
        activity_type: "tugas",
        title: "Follow up",
        notes: null,
        due_at: "2026-09-01T00:00:00Z",
        done_at: "2026-09-03T00:00:00Z",
        status: "done",
        priority: "normal",
        created_at: "2026-08-30T00:00:00Z",
        owner_name: null,
      },
      {
        id: "b",
        activity_type: "telepon",
        title: null,
        notes: "tidak diangkat",
        due_at: null,
        done_at: null,
        status: "open",
        priority: "normal",
        created_at: "2026-08-31T00:00:00Z",
        owner_name: null,
        deal_title: "Field Trip",
      },
    ]);
    expect(done.at).toBe("2026-09-03T00:00:00Z");
    expect(done.kind).toBe("task");
    expect(call.kind).toBe("activity");
    expect(call.title).toBe("Telepon · Field Trip");
  });

  test("limit dipatuhi; tanggal tak valid ditaruh paling akhir", () => {
    const events = mergeTimeline(
      {
        leads: [
          { id: "l1", org_name: "A", status: "baru", created_at: "not-a-date" },
          { id: "l2", org_name: "B", status: "baru", created_at: "2026-09-02T00:00:00Z" },
          { id: "l3", org_name: "C", status: "baru", created_at: "2026-09-03T00:00:00Z" },
        ],
      },
      2
    );
    expect(events.map((e) => e.key)).toEqual(["lead:l3", "lead:l2"]);
  });

  test("groupByDay memakai zona Asia/Jakarta", () => {
    // 2026-09-12 17:30 UTC = 13 Sep 00:30 WIB
    const groups = groupByDay([
      { key: "x", kind: "note", at: "2026-09-12T17:30:00Z", title: "x" },
      { key: "y", kind: "note", at: "2026-09-12T10:00:00Z", title: "y" },
    ]);
    expect(groups.map((g) => g.day)).toEqual(["2026-09-13", "2026-09-12"]);
  });
});

import { describe, expect, test } from "vitest";
import {
  createTaskSchema,
  nextOccurrence,
  resolveTaskStatus,
  resolveTaskSubject,
  spawnNextTask,
  updateTaskSchema,
} from "./tasks";

const UUID = "11111111-1111-4111-8111-111111111111";
const UUID2 = "22222222-2222-4222-8222-222222222222";

describe("createTaskSchema (EPIC-050 Fase 1)", () => {
  test("klien lama: deal_id saja tetap sah, default tugas/normal/open", () => {
    const parsed = createTaskSchema.safeParse({ deal_id: UUID, notes: "telp PIC" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.activity_type).toBe("tugas");
      expect(parsed.data.priority).toBe("normal");
      expect(parsed.data.status).toBe("open");
    }
  });

  test("klien baru: subject_type + subject_id (account) sah", () => {
    const parsed = createTaskSchema.safeParse({
      subject_type: "account",
      subject_id: UUID,
      title: "Kirim proposal",
      priority: "high",
    });
    expect(parsed.success).toBe(true);
  });

  test("tanpa subjek ditolak", () => {
    expect(createTaskSchema.safeParse({ title: "x" }).success).toBe(false);
  });

  test("rekurensi tanpa due_at ditolak; dengan due_at sah", () => {
    const base = { subject_type: "contact", subject_id: UUID, recurrence: { freq: "weekly" } };
    expect(createTaskSchema.safeParse(base).success).toBe(false);
    expect(
      createTaskSchema.safeParse({ ...base, due_at: "2026-09-15T09:00:00+07:00" }).success
    ).toBe(true);
  });

  test("kanal pengingat hanya wa/in_app/email", () => {
    const parsed = createTaskSchema.safeParse({
      lead_id: UUID,
      reminder_channels: ["wa", "sms"],
    });
    expect(parsed.success).toBe(false);
  });

  test("updateTaskSchema strict: field asing ditolak", () => {
    expect(updateTaskSchema.safeParse({ done_at: "x" }).success).toBe(false);
    expect(updateTaskSchema.safeParse({ status: "in_progress" }).success).toBe(true);
  });
});

describe("resolveTaskSubject / resolveTaskStatus", () => {
  test("deal diprioritaskan di atas lead dan subject eksplisit", () => {
    expect(
      resolveTaskSubject({ deal_id: UUID, lead_id: UUID2, subject_type: "account", subject_id: UUID2 })
    ).toEqual({ subject_type: "deal", subject_id: UUID });
  });

  test("subject eksplisit dipakai bila tanpa deal/lead", () => {
    expect(resolveTaskSubject({ subject_type: "member", subject_id: UUID })).toEqual({
      subject_type: "member",
      subject_id: UUID,
    });
    expect(resolveTaskSubject({})).toBeNull();
  });

  test("status eksplisit menang; is_done dipetakan done/open", () => {
    expect(resolveTaskStatus({ status: "cancelled", is_done: true })).toBe("cancelled");
    expect(resolveTaskStatus({ is_done: true })).toBe("done");
    expect(resolveTaskStatus({ is_done: false })).toBe("open");
    expect(resolveTaskStatus({})).toBeUndefined();
  });
});

describe("nextOccurrence", () => {
  const from = new Date("2026-01-31T02:00:00Z");

  test("harian & mingguan menggeser dengan interval", () => {
    expect(nextOccurrence(from, { freq: "daily", interval: 3, until: null })?.toISOString()).toBe(
      "2026-02-03T02:00:00.000Z"
    );
    expect(nextOccurrence(from, { freq: "weekly", interval: 2, until: null })?.toISOString()).toBe(
      "2026-02-14T02:00:00.000Z"
    );
  });

  test("bulanan di-clamp ke akhir bulan (31 Jan → 28 Feb 2026)", () => {
    expect(nextOccurrence(from, { freq: "monthly", interval: 1, until: null })?.toISOString()).toBe(
      "2026-02-28T02:00:00.000Z"
    );
  });

  test("melewati until → null (inklusif di hari until)", () => {
    expect(nextOccurrence(from, { freq: "daily", interval: 1, until: "2026-01-31" })).toBeNull();
    expect(nextOccurrence(from, { freq: "daily", interval: 1, until: "2026-02-01" })).not.toBeNull();
  });
});

describe("spawnNextTask", () => {
  test("reminder digeser dengan selisih yang sama terhadap due", () => {
    const next = spawnNextTask({
      due_at: "2026-09-15T09:00:00Z",
      reminder_at: "2026-09-15T08:00:00Z",
      recurrence: { freq: "weekly", interval: 1, until: null },
    });
    expect(next?.due_at.toISOString()).toBe("2026-09-22T09:00:00.000Z");
    expect(next?.reminder_at?.toISOString()).toBe("2026-09-22T08:00:00.000Z");
  });

  test("tanpa reminder → reminder null; seri habis → null", () => {
    expect(
      spawnNextTask({
        due_at: "2026-09-15T09:00:00Z",
        recurrence: { freq: "daily", interval: 1, until: null },
      })?.reminder_at
    ).toBeNull();
    expect(
      spawnNextTask({
        due_at: "2026-09-15T09:00:00Z",
        recurrence: { freq: "daily", interval: 1, until: "2026-09-15" },
      })
    ).toBeNull();
  });
});

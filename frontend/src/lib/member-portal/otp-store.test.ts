// OTP portal member: percobaan diklaim ATOMIK sebelum kode dibandingkan, jadi
// tebakan paralel tidak bisa melewati batas per kode.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/whatsapp", () => ({ sendWhatsAppOtp: vi.fn() }));
vi.mock("@/lib/db", () => ({ getPool: vi.fn() }));

import { hashSecret, OTP_MAX_ATTEMPTS } from "./otp";
import { consumeOtp } from "./otp-store";

/** Tabel OTP palsu dengan semantik UPDATE ... WHERE yang sama dengan Postgres. */
function fakeDb(code: string) {
  const row = {
    id: "otp-1",
    code_hash: hashSecret(code),
    attempts: 0,
    expires_at: new Date(Date.now() + 60_000),
    consumed_at: null as Date | null,
  };
  const db = {
    row,
    query: vi.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes("SELECT")) return { rows: [{ ...row }] };
      if (sql.includes("attempts = attempts + 1")) {
        if (row.attempts < (params[1] as number) && !row.consumed_at) {
          row.attempts += 1;
          return { rows: [{ id: row.id }] };
        }
        return { rows: [] };
      }
      if (sql.includes("consumed_at = now()")) {
        if (row.consumed_at) return { rows: [] };
        row.consumed_at = new Date();
        return { rows: [{ id: row.id }] };
      }
      throw new Error(`unexpected sql: ${sql}`);
    }),
  };
  return db;
}

describe("consumeOtp", () => {
  it("kode benar → ok dan terpakai", async () => {
    const db = fakeDb("123456");
    expect(await consumeOtp(db as never, "628123", "123456")).toEqual({ ok: true });
    expect(db.row.consumed_at).not.toBeNull();
  });

  it("tebakan paralel: hanya OTP_MAX_ATTEMPTS yang sempat dibandingkan", async () => {
    const db = fakeDb("123456");
    const guesses = Array.from({ length: 20 }, (_, i) => String(100000 + i));
    const results = await Promise.all(guesses.map((g) => consumeOtp(db as never, "628123", g)));
    const compared = results.filter((r) => !r.ok && r.error === "Kode salah").length;
    expect(compared).toBe(OTP_MAX_ATTEMPTS);
    expect(results.filter((r) => !r.ok && r.status === 429)).toHaveLength(20 - OTP_MAX_ATTEMPTS);
    expect(db.row.attempts).toBe(OTP_MAX_ATTEMPTS);
  });

  it("setelah batas, kode benar pun ditolak", async () => {
    const db = fakeDb("123456");
    db.row.attempts = OTP_MAX_ATTEMPTS;
    expect(await consumeOtp(db as never, "628123", "123456")).toMatchObject({ ok: false, status: 429 });
  });

  it("dua klaim bersamaan dengan kode benar → hanya satu sesi", async () => {
    const db = fakeDb("123456");
    const [a, b] = await Promise.all([
      consumeOtp(db as never, "628123", "123456"),
      consumeOtp(db as never, "628123", "123456"),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
  });
});

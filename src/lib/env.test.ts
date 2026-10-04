import { afterEach, describe, expect, it, vi } from "vitest";
import { assertServerEnv, databaseUrl, disabledIntegrations } from "./env";

const DB = "postgres://app@localhost:5432/nuhabit";

const fullEnv = {
  DATABASE_URL: DB,
  NEXT_PUBLIC_APP_URL: "https://app.nuhabit.id",
  RESEND_API_KEY: "re_x",
  XENDIT_SECRET_KEY: "xnd_x",
  XENDIT_WEBHOOK_TOKEN: "tok",
  VAPID_PUBLIC_KEY: "pub",
  VAPID_PRIVATE_KEY: "priv",
};

describe("databaseUrl", () => {
  it("memakai DATABASE_URL lebih dulu", () => {
    expect(databaseUrl({ DATABASE_URL: DB, MIGRATE_DATABASE_URL: "postgres://other" })).toBe(DB);
  });

  it("jatuh ke MIGRATE_DATABASE_URL bila DATABASE_URL kosong", () => {
    expect(databaseUrl({ DATABASE_URL: " ", MIGRATE_DATABASE_URL: DB })).toBe(DB);
  });

  it("kosong bila keduanya tidak diset", () => {
    expect(databaseUrl({})).toBe("");
  });
});

describe("assertServerEnv", () => {
  afterEach(() => vi.restoreAllMocks());

  it("gagal cepat dengan pesan jelas bila URL database kosong", () => {
    expect(() => assertServerEnv({})).toThrow(/DATABASE_URL \(atau MIGRATE_DATABASE_URL\) wajib/);
  });

  it("menolak URL yang bukan postgres", () => {
    expect(() => assertServerEnv({ DATABASE_URL: "mysql://x" })).toThrow(/postgres:\/\//);
  });

  it("menerima MIGRATE_DATABASE_URL sebagai satu-satunya URL", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => assertServerEnv({ MIGRATE_DATABASE_URL: DB })).not.toThrow();
  });

  it("satu peringatan berisi semua integrasi opsional yang mati", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    assertServerEnv({ DATABASE_URL: DB });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("RESEND_API_KEY");
    expect(warn.mock.calls[0][0]).toContain("XENDIT_SECRET_KEY");
  });

  it("diam bila semua integrasi opsional terisi", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    assertServerEnv(fullEnv);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("disabledIntegrations", () => {
  it("Xendit butuh secret key dan webhook token, kecuali mode mock", () => {
    const noToken = { ...fullEnv, XENDIT_WEBHOOK_TOKEN: undefined };
    expect(disabledIntegrations(noToken)).toEqual([expect.stringContaining("Xendit")]);
    expect(disabledIntegrations({ ...noToken, XENDIT_MOCK: "1" })).toEqual([]);
  });

  it("NEXT_PUBLIC_BASE_URL lama tetap dihitung sebagai URL publik", () => {
    const legacy = { ...fullEnv, NEXT_PUBLIC_APP_URL: undefined, NEXT_PUBLIC_BASE_URL: "https://lama.nuhabit.id" };
    expect(disabledIntegrations(legacy)).toEqual([]);
  });
});

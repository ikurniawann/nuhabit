import { afterEach, describe, expect, test } from "vitest";
import { isValidWebhookToken, isXenditConfigured } from "./client";

const ENV_KEYS = ["XENDIT_WEBHOOK_TOKEN", "XENDIT_SECRET_KEY", "XENDIT_MOCK"];
const saved = new Map(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("isValidWebhookToken", () => {
  test("token salah ditolak", () => {
    process.env.XENDIT_WEBHOOK_TOKEN = "rahasia-benar";
    expect(isValidWebhookToken("rahasia-salah")).toBe(false);
  });

  test("token benar diterima", () => {
    process.env.XENDIT_WEBHOOK_TOKEN = "rahasia-benar";
    expect(isValidWebhookToken("rahasia-benar")).toBe(true);
  });

  test("header kosong ditolak", () => {
    process.env.XENDIT_WEBHOOK_TOKEN = "rahasia-benar";
    expect(isValidWebhookToken(null)).toBe(false);
    expect(isValidWebhookToken("")).toBe(false);
  });

  test("env belum dikonfigurasi → SEMUA ditolak (fail closed)", () => {
    delete process.env.XENDIT_WEBHOOK_TOKEN;
    expect(isValidWebhookToken("apa-pun")).toBe(false);
    // Kirim string kosong saat expected kosong pun tetap ditolak
    process.env.XENDIT_WEBHOOK_TOKEN = "";
    expect(isValidWebhookToken("")).toBe(false);
  });
});

describe("isXenditConfigured", () => {
  test("tanpa key & tanpa mock → false (route menolak 503 sebelum insert)", () => {
    delete process.env.XENDIT_SECRET_KEY;
    delete process.env.XENDIT_MOCK;
    expect(isXenditConfigured()).toBe(false);
  });

  test("mock dev dihitung terkonfigurasi", () => {
    delete process.env.XENDIT_SECRET_KEY;
    process.env.XENDIT_MOCK = "1";
    expect(isXenditConfigured()).toBe(true);
  });
});

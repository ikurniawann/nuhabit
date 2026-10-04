import { describe, expect, test } from "vitest";
import {
  isSafeLink,
  normalizeChannels,
  renderInAppBody,
  selectDueCampaigns,
  shouldAbortCampaign,
  validateSchedule,
} from "./campaigns";

const NOW = new Date("2026-10-04T03:00:00.000Z");

describe("normalizeChannels", () => {
  test("kosong atau sampah jatuh ke WA (perilaku lama)", () => {
    expect(normalizeChannels(undefined)).toEqual(["wa"]);
    expect(normalizeChannels(["sms"])).toEqual(["wa"]);
  });
  test("duplikat dibuang, urutan baku", () => {
    expect(normalizeChannels(["in_app", "wa", "in_app"])).toEqual(["wa", "in_app"]);
    expect(normalizeChannels(["in_app"])).toEqual(["in_app"]);
  });
});

describe("validateSchedule", () => {
  test("minimal 5 menit dari sekarang", () => {
    expect(validateSchedule("2026-10-04T03:04:00Z", NOW)).toEqual({ ok: false, reason: "jadwal-terlalu-dekat" });
    const ok = validateSchedule("2026-10-04T03:05:00Z", NOW);
    expect(ok.ok).toBe(true);
  });
  test("waktu lampau dan tanggal rusak ditolak", () => {
    expect(validateSchedule("2026-10-03T03:00:00Z", NOW)).toEqual({ ok: false, reason: "jadwal-terlalu-dekat" });
    expect(validateSchedule("besok pagi", NOW)).toEqual({ ok: false, reason: "jadwal-tidak-valid" });
  });
  test("maksimal 90 hari ke depan", () => {
    expect(validateSchedule("2027-01-03T03:00:00Z", NOW).ok).toBe(false);
    expect(validateSchedule("2027-01-01T03:00:00Z", NOW).ok).toBe(true);
  });
});

describe("selectDueCampaigns", () => {
  const rows = [
    { id: "late", status: "scheduled", scheduled_at: "2026-10-04T02:00:00Z" },
    { id: "now", status: "scheduled", scheduled_at: NOW },
    { id: "future", status: "scheduled", scheduled_at: "2026-10-04T03:00:01Z" },
    { id: "cancelled", status: "cancelled", scheduled_at: "2026-10-04T01:00:00Z" },
    { id: "no-time", status: "scheduled", scheduled_at: null },
  ];
  test("hanya scheduled yang jatuh tempo, paling lama menunggu lebih dulu", () => {
    expect(selectDueCampaigns(rows, NOW).map((c) => c.id)).toEqual(["late", "now"]);
  });
  test("tidak ada yang jatuh tempo → kosong", () => {
    expect(selectDueCampaigns(rows, new Date("2026-10-04T01:00:00Z"))).toEqual([]);
  });
});

describe("shouldAbortCampaign", () => {
  const failed = (n: number) => Array<"failed">(n).fill("failed");
  test("10 gagal beruntun terbaru → hentikan", () => {
    expect(shouldAbortCampaign(failed(10))).toBe(true);
    expect(shouldAbortCampaign([...failed(10), "sent"])).toBe(true);
  });
  test("satu sukses di antara 10 terakhir → lanjut", () => {
    expect(shouldAbortCampaign([...failed(9), "sent", ...failed(5)])).toBe(false);
  });
  test("data kurang dari ambang → lanjut", () => {
    expect(shouldAbortCampaign(failed(9))).toBe(false);
  });
});

describe("renderInAppBody", () => {
  test("placeholder terganti tanpa footer STOP", () => {
    expect(renderInAppBody("Halo {nama}, kode {kode}", { nama: "Sari", kode: "WIN-1" })).toBe("Halo Sari, kode WIN-1");
  });
  test("tanpa voucher, {kode} dibersihkan", () => {
    expect(renderInAppBody("Halo {nama} {kode} ya", { nama: "Sari", kode: null })).toBe("Halo Sari ya");
  });
});

describe("isSafeLink", () => {
  test("path portal dan URL http(s) diterima", () => {
    expect(isSafeLink("/member/events")).toBe(true);
    expect(isSafeLink("https://bcd.id/promo")).toBe(true);
  });
  test("protocol-relative dan skema lain ditolak", () => {
    expect(isSafeLink("//evil.test")).toBe(false);
    expect(isSafeLink("javascript:alert(1)")).toBe(false);
    expect(isSafeLink("https://")).toBe(false);
  });
});

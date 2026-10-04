import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getPool: vi.fn() }));

import { getPool } from "@/lib/db";
import { buildPushPayload, sendMemberPush, vapidConfig } from "./push";

describe("buildPushPayload", () => {
  it("tautan eksplisit menjadi URL portal", () => {
    expect(JSON.parse(buildPushPayload({ title: "Promo baru", body: "Diskon 10%", link: "promo:kopi10" }))).toEqual({
      title: "Promo baru",
      body: "Diskon 10%",
      url: "/member?go=promo%3Akopi10",
      tag: "member",
    });
  });

  it("tanpa tautan, tujuan diturunkan dari jenis notifikasi", () => {
    const payload = JSON.parse(buildPushPayload({ title: "Terdaftar", body: "", type: "booking_confirmed" }));
    expect(payload.url).toBe("/member?go=events");
    expect(payload.tag).toBe("booking_confirmed");
  });

  it("tautan tak dikenal atau URL luar jatuh ke /member", () => {
    expect(JSON.parse(buildPushPayload({ title: "x", link: "https://evil.example" })).url).toBe("/member");
    expect(JSON.parse(buildPushPayload({ title: "x", type: "lainnya" })).url).toBe("/member");
  });

  it("memotong judul dan isi panjang, judul kosong diganti nama brand", () => {
    const payload = JSON.parse(buildPushPayload({ title: "  ", body: "a".repeat(400) }));
    expect(payload.title).toBe("NüHabit");
    expect(payload.body).toHaveLength(180);
    expect(payload.body.endsWith("…")).toBe(true);
  });
});

describe("vapidConfig", () => {
  it("null bila kunci tidak lengkap; subject punya bawaan", () => {
    expect(vapidConfig({ VAPID_PUBLIC_KEY: "pub" })).toBeNull();
    expect(vapidConfig({ VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" })).toEqual({
      publicKey: "pub",
      privateKey: "priv",
      subject: "mailto:admin@localhost",
    });
  });
});

describe("sendMemberPush", () => {
  it("diam tanpa menyentuh DB bila kunci VAPID tidak ada", async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "");
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    await expect(sendMemberPush("c1", { title: "Halo" })).resolves.toBe(0);
    expect(getPool).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("tidak pernah melempar walau DB gagal", async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "pub");
    vi.stubEnv("VAPID_PRIVATE_KEY", "priv");
    vi.mocked(getPool).mockReturnValue({ query: vi.fn().mockRejectedValue(new Error("down")) } as never);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(sendMemberPush("c1", { title: "Halo" })).resolves.toBe(0);
    warn.mockRestore();
    vi.unstubAllEnvs();
  });
});

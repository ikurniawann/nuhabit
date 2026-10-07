import { describe, expect, it } from "vitest";
import {
  isDirectChatJid,
  jidToPhone,
  messagePreview,
  normalizeInbound,
} from "@/lib/whatsapp/inbound";

describe("isDirectChatJid & jidToPhone", () => {
  it("hanya chat personal yang diterima", () => {
    expect(isDirectChatJid("628123456789@s.whatsapp.net")).toBe(true);
    expect(isDirectChatJid("123456-987@g.us")).toBe(false); // grup
    expect(isDirectChatJid("status@broadcast")).toBe(false);
    expect(isDirectChatJid(null)).toBe(false);
  });

  it("suffix device (:12) pada JID ikut terpotong", () => {
    expect(jidToPhone("628123456789:12@s.whatsapp.net")).toBe("628123456789");
  });

  it("nomor di luar panjang wajar ditolak", () => {
    expect(jidToPhone("123@s.whatsapp.net")).toBeNull();
  });
});

describe("normalizeInbound", () => {
  const base = {
    remoteJid: "628123456789@s.whatsapp.net",
    fromMe: false,
    messageId: "ABC123",
    timestamp: 1_752_910_000,
    text: "Halo, saya mau komplain pesanan",
    mediaType: null,
    pushName: "Budi",
  };

  it("pesan teks masuk → direction in, body terisi", () => {
    const result = normalizeInbound(base);

    expect(result).not.toBeNull();
    expect(result?.direction).toBe("in");
    expect(result?.phone).toBe("628123456789");
    expect(result?.body).toBe("Halo, saya mau komplain pesanan");
    expect(result?.providerMessageId).toBe("ABC123");
    expect(result?.sentAt).toEqual(new Date(1_752_910_000 * 1000));
  });

  it("fromMe (balasan manual dari HP) → direction out", () => {
    expect(normalizeInbound({ ...base, fromMe: true })?.direction).toBe("out");
  });

  it("pesan grup ditolak", () => {
    expect(normalizeInbound({ ...base, remoteJid: "12345-99@g.us" })).toBeNull();
  });

  it("media tanpa teks tetap tersimpan dengan mediaType", () => {
    const result = normalizeInbound({ ...base, text: null, mediaType: "image" });

    expect(result?.body).toBeNull();
    expect(result?.mediaType).toBe("image");
  });

  it("tanpa teks & tanpa media (reaksi/protokol) diabaikan", () => {
    expect(normalizeInbound({ ...base, text: "", mediaType: null })).toBeNull();
  });

  it("mediaType di luar daftar dikenal dianggap tidak ada", () => {
    expect(normalizeInbound({ ...base, text: null, mediaType: "poll" })).toBeNull();
  });

  it("body panjang dipotong 4000 karakter", () => {
    const result = normalizeInbound({ ...base, text: "x".repeat(9000) });
    expect(result?.body?.length).toBe(4000);
  });
});

describe("messagePreview", () => {
  it("teks pendek apa adanya, panjang dipotong, media pakai penanda", () => {
    expect(messagePreview("Halo", null)).toBe("Halo");
    expect(messagePreview("y".repeat(100), null).length).toBe(80);
    expect(messagePreview(null, "image")).toBe("[image]");
  });
});

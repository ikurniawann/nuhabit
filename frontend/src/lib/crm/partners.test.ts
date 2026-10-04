import { describe, expect, test } from "vitest";
import {
  decideEvent,
  isTimestampFresh,
  matchSubject,
  partnerChannel,
  PARTNER_XP_CAP,
  signPayload,
  verifySignature,
  type MatchCandidate,
} from "./partners";

const SECRET = "a".repeat(64);
const BODY = JSON.stringify({ external_id: "evt-1", event_type: "photo_session", phone: "0812345678" });

describe("verifySignature", () => {
  test("HMAC-SHA256 raw body dengan secret partner", () => {
    expect(verifySignature(BODY, signPayload(BODY, SECRET), SECRET)).toBe(true);
  });
  test("body diubah satu karakter → ditolak", () => {
    expect(verifySignature(BODY + " ", signPayload(BODY, SECRET), SECRET)).toBe(false);
  });
  test("secret lain, tanpa prefix, hex rusak, atau partner tanpa secret → ditolak", () => {
    const sig = signPayload(BODY, SECRET);
    expect(verifySignature(BODY, sig, "b".repeat(64))).toBe(false);
    expect(verifySignature(BODY, sig.replace("sha256=", ""), SECRET)).toBe(false);
    expect(verifySignature(BODY, "sha256=zz", SECRET)).toBe(false);
    expect(verifySignature(BODY, sig, null)).toBe(false);
    expect(verifySignature(BODY, null, SECRET)).toBe(false);
  });
});

describe("isTimestampFresh", () => {
  const now = new Date("2026-10-04T03:00:00Z");
  const unix = Math.floor(now.getTime() / 1000);
  test("dalam toleransi 5 menit, ke dua arah", () => {
    expect(isTimestampFresh(String(unix - 300), now)).toBe(true);
    expect(isTimestampFresh(String(unix + 300), now)).toBe(true);
  });
  test("lewat 5 menit ditolak", () => {
    expect(isTimestampFresh(String(unix - 301), now)).toBe(false);
    expect(isTimestampFresh(String(unix + 301), now)).toBe(false);
  });
  test("bukan detik Unix (milidetik, ISO, kosong) ditolak", () => {
    expect(isTimestampFresh(String(now.getTime()), now)).toBe(false);
    expect(isTimestampFresh(now.toISOString(), now)).toBe(false);
    expect(isTimestampFresh(null, now)).toBe(false);
  });
});

describe("matchSubject", () => {
  const candidates: MatchCandidate[] = [
    { customerId: "sari", email: "Sari@Mail.com", phone: "081234567890" },
    { customerId: "budi", email: null, phone: "+62 811-1111-2222" },
  ];
  test("email tanpa peduli huruf besar", () => {
    expect(matchSubject("sari@mail.COM", candidates)).toBe("sari");
  });
  test("telepon dicocokkan 8 digit terakhir (+62 = 08)", () => {
    expect(matchSubject("+6281234567890", candidates)).toBe("sari");
    expect(matchSubject("0811 1111 2222", candidates)).toBe("budi");
  });
  test("nama, email tak dikenal, dan nomor pendek tidak dicocokkan", () => {
    expect(matchSubject("Sari", candidates)).toBeNull();
    expect(matchSubject("lain@mail.com", candidates)).toBeNull();
    expect(matchSubject("4567890", candidates)).toBeNull();
    expect(matchSubject("  ", candidates)).toBeNull();
  });
  test("nomor yang cocok ke dua member dibiarkan unmatched", () => {
    const twins = [...candidates, { customerId: "kembar", email: null, phone: "0899 3456 7890" }];
    expect(matchSubject("081234567890", twins)).toBeNull();
  });
});

describe("decideEvent", () => {
  const partner = { is_active: true, awards_xp: true, xp_per_event: 50 };
  test("tanpa member → unmatched, tanpa XP", () => {
    expect(decideEvent(partner, false)).toEqual({ status: "unmatched", xp: 0 });
  });
  test("partner nonaktif → ignored", () => {
    expect(decideEvent({ ...partner, is_active: false }, true)).toEqual({ status: "ignored", xp: 0 });
  });
  test("partner hanya dicatat (awards_xp mati) → processed tanpa XP", () => {
    expect(decideEvent({ ...partner, awards_xp: false }, true)).toEqual({ status: "processed", xp: 0 });
  });
  test("XP per event dijepit ke batas", () => {
    expect(decideEvent(partner, true)).toEqual({ status: "processed", xp: 50 });
    expect(decideEvent({ ...partner, xp_per_event: 1_000_000 }, true).xp).toBe(PARTNER_XP_CAP);
  });
});

describe("partnerChannel", () => {
  test("photobooth/studio_game memakai kanalnya; lainnya dicatat manual di ledger", () => {
    expect(partnerChannel("photobooth")).toEqual({ eventChannel: "photobooth", ledgerChannel: "photobooth" });
    expect(partnerChannel("other")).toEqual({ eventChannel: "other", ledgerChannel: "manual" });
  });
});

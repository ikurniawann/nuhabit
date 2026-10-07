import { describe, expect, it } from "vitest";
import {
  defaultWaNotifConfig,
  normalizeWaRecipient,
  parseWaNotifConfig,
  MAX_RECIPIENTS,
  WA_NOTIF_TYPES,
} from "./notifications-config";

describe("normalizeWaRecipient", () => {
  it("mengubah 08… menjadi 628…", () => {
    expect(normalizeWaRecipient("085880974659")).toBe("6285880974659");
  });

  it("menerima +62 dan 62, membuang spasi/strip", () => {
    expect(normalizeWaRecipient("+62 858-8097-4659")).toBe("6285880974659");
    expect(normalizeWaRecipient("6285880974659")).toBe("6285880974659");
  });

  it("menolak nomor asing dan sampah", () => {
    expect(normalizeWaRecipient("14155552671")).toBeNull(); // AS
    expect(normalizeWaRecipient("abc")).toBeNull();
    expect(normalizeWaRecipient("")).toBeNull();
    expect(normalizeWaRecipient("62")).toBeNull(); // terlalu pendek
  });
});

describe("parseWaNotifConfig", () => {
  it("null → default: mati, tanpa penerima, semua jenis sesuai defaultnya", () => {
    const cfg = parseWaNotifConfig(null);
    expect(cfg.enabled).toBe(false);
    expect(cfg.recipients).toEqual([]);
    for (const t of WA_NOTIF_TYPES) expect(cfg.types[t.key]).toBe(t.defaultOn);
  });

  it("JSON rusak tidak meledak — jatuh ke default", () => {
    expect(parseWaNotifConfig("{rusak")).toEqual(defaultWaNotifConfig());
  });

  it("menormalkan & mendedup penerima, membuang yang tidak valid", () => {
    const cfg = parseWaNotifConfig(
      JSON.stringify({ recipients: ["0858 8097 4659", "6285880974659", "abc", "+62811000111"] })
    );
    expect(cfg.recipients).toEqual(["6285880974659", "62811000111"]);
  });

  it("membatasi jumlah penerima", () => {
    const many = Array.from({ length: 10 }, (_, i) => `0812000000${i}`);
    const cfg = parseWaNotifConfig(JSON.stringify({ recipients: many }));
    expect(cfg.recipients.length).toBeLessThanOrEqual(MAX_RECIPIENTS);
  });

  it("field types parsial: yang dikenal dipakai, sisanya default", () => {
    const cfg = parseWaNotifConfig(JSON.stringify({ types: { digest: false, asing: true } }));
    expect(cfg.types.digest).toBe(false);
    expect(cfg.types.voidBesar).toBe(true);
    expect((cfg.types as Record<string, unknown>).asing).toBeUndefined();
  });

  it("ambang void negatif/aneh jatuh ke default", () => {
    expect(parseWaNotifConfig(JSON.stringify({ voidThresholdRp: -5 })).voidThresholdRp).toBe(500_000);
    expect(parseWaNotifConfig(JSON.stringify({ voidThresholdRp: "x" })).voidThresholdRp).toBe(500_000);
    expect(parseWaNotifConfig(JSON.stringify({ voidThresholdRp: 250_000.7 })).voidThresholdRp).toBe(250_001);
  });
});

describe("digestHour (Fase B)", () => {
  it("default 22 dan ikut tersimpan", () => {
    expect(defaultWaNotifConfig().digestHour).toBe(22);
    expect(parseWaNotifConfig(JSON.stringify({ digestHour: 21 })).digestHour).toBe(21);
  });

  it("nilai di luar 0-23 / non-integer jatuh ke default", () => {
    expect(parseWaNotifConfig(JSON.stringify({ digestHour: 24 })).digestHour).toBe(22);
    expect(parseWaNotifConfig(JSON.stringify({ digestHour: -1 })).digestHour).toBe(22);
    expect(parseWaNotifConfig(JSON.stringify({ digestHour: 21.5 })).digestHour).toBe(22);
    expect(parseWaNotifConfig(JSON.stringify({ digestHour: "22" })).digestHour).toBe(22);
  });
});

describe("omzetAnjlokPct (Fase D)", () => {
  it("default 80, nilai valid tersimpan, di luar 1-99 jatuh ke default", () => {
    expect(defaultWaNotifConfig().omzetAnjlokPct).toBe(80);
    expect(parseWaNotifConfig(JSON.stringify({ omzetAnjlokPct: 60 })).omzetAnjlokPct).toBe(60);
    expect(parseWaNotifConfig(JSON.stringify({ omzetAnjlokPct: 0 })).omzetAnjlokPct).toBe(80);
    expect(parseWaNotifConfig(JSON.stringify({ omzetAnjlokPct: 100 })).omzetAnjlokPct).toBe(80);
    expect(parseWaNotifConfig(JSON.stringify({ omzetAnjlokPct: 79.5 })).omzetAnjlokPct).toBe(80);
  });
});

describe("jenis prMendesak (owner 2026-09-04)", () => {
  it("terdaftar sebagai jenis kritis dan aktif secara default", () => {
    const meta = WA_NOTIF_TYPES.find((t) => t.key === "prMendesak");
    expect(meta?.tier).toBe("kritis");
    expect(meta?.defaultOn).toBe(true);
    expect(defaultWaNotifConfig().types.prMendesak).toBe(true);
  });

  it("config lama tanpa kunci prMendesak tetap terbaca (jatuh ke default aktif)", () => {
    const cfg = parseWaNotifConfig(JSON.stringify({ enabled: true, recipients: ["0812345678"], types: { digest: false } }));
    expect(cfg.types.prMendesak).toBe(true);
    expect(cfg.types.digest).toBe(false);
  });
});

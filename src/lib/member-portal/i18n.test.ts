import { readdirSync, readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { TXN_LABELS } from "@/features/member-portal/format";
import { EN, parseLang, translate } from "./i18n";

describe("translate", () => {
  it("ID mengembalikan kunci apa adanya, EN memakai kamus", () => {
    expect(translate("id", "Keluar")).toBe("Keluar");
    expect(translate("en", "Keluar")).toBe("Sign out");
  });

  it("kunci tanpa terjemahan jatuh ke teks Indonesia", () => {
    expect(translate("en", "Teks yang belum diterjemahkan")).toBe("Teks yang belum diterjemahkan");
  });

  it("mengisi placeholder di kedua bahasa dan membiarkan placeholder tanpa nilai", () => {
    expect(translate("id", "{n} XP lagi menuju {tier}", { n: "1.200", tier: "Gold" })).toBe("1.200 XP lagi menuju Gold");
    expect(translate("en", "{n} XP lagi menuju {tier}", { n: "1.200", tier: "Gold" })).toBe("1.200 XP to Gold");
    expect(translate("en", "Sampai {date}", {})).toBe("Until {date}");
  });

  it("parseLang hanya mengenal en; selain itu id", () => {
    expect(parseLang("en")).toBe("en");
    expect(parseLang("EN")).toBe("id");
    expect(parseLang(null)).toBe("id");
  });
});

describe("kelengkapan kamus EN portal mobile", () => {
  const dir = path.resolve(__dirname, "../../features/member-portal/mobile");
  const keys = new Set<string>();
  // Layar top-up & ulasan dikirim workstream lain dengan teks Indonesia sendiri.
  const external = new Set(["mobile-topup.tsx", "mobile-reviews.tsx"]);
  const files = readdirSync(dir, { recursive: true, encoding: "utf8" }).filter(
    (name) => /\.tsx?$/.test(name) && !external.has(path.basename(name))
  );
  for (const file of files) {
    const source = readFileSync(path.join(dir, file), "utf8");
    for (const match of source.matchAll(/\bt\("((?:[^"\\]|\\.)*)"/g)) keys.add(match[1]);
  }
  // Label yang diterjemahkan lewat peta/variabel, bukan literal t("...").
  const dynamic = [
    "Beranda", "Riwayat", "Profil", "Kelas", "Kredit",
    "Di kasir", "Kasir & tiket", "Tiket online", "Tiket di loket",
    "Terbatas", "Legendaris", "Epik", "Langka", "Umum",
    "Menunggu diambil", "Disetujui", "Sudah diambil", "Dibatalkan", "Ditolak",
    ...Object.values(TXN_LABELS),
    "Nomor WhatsApp tidak valid", "Nama minimal 2 huruf", "Nama terlalu panjang",
    "Format email tidak valid", "Tanggal lahir tidak valid",
  ];

  it("menemukan teks portal untuk diperiksa", () => {
    expect(keys.size).toBeGreaterThan(150);
  });

  it("setiap teks portal punya terjemahan EN", () => {
    const missing = [...keys, ...dynamic].filter((key) => !(key in EN));
    expect(missing).toEqual([]);
  });

  it("placeholder EN sama dengan placeholder kuncinya", () => {
    const names = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const mismatched = Object.entries(EN).filter(([id, en]) => names(id).join() !== names(en).join());
    expect(mismatched).toEqual([]);
  });
});

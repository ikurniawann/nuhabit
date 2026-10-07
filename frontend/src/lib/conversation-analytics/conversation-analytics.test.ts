import { describe, expect, it } from "vitest";
import {
  aggregateKeywords,
  buildAnalysisMessages,
  fingerprintTranscript,
  normalizeKeyword,
  normalizeKeywordList,
  parseInsight,
  sentimentBreakdown,
  topicDistribution,
  transcriptToText,
  type TranscriptMessage,
} from "./index";

describe("normalizeKeyword", () => {
  it("merapikan huruf besar, tanda baca, dan spasi ganda", () => {
    expect(normalizeKeyword("  Pengiriman,  Lambat!! ")).toBe("pengiriman lambat");
  });

  it("membuang stopword, kata terlalu pendek, dan angka polos", () => {
    expect(normalizeKeyword("yang")).toBe("");
    expect(normalizeKeyword("ya")).toBe("");
    expect(normalizeKeyword("123")).toBe("");
    expect(normalizeKeyword("10rb")).toBe("");
  });

  it("frasa yang seluruhnya stopword dibuang, campuran dipertahankan", () => {
    expect(normalizeKeyword("terima kasih")).toBe("");
    expect(normalizeKeyword("tidak bisa login")).toBe("tidak bisa login");
  });

  it("input non-string aman", () => {
    expect(normalizeKeyword(42)).toBe("");
    expect(normalizeKeyword(null)).toBe("");
  });
});

describe("normalizeKeywordList", () => {
  it("membuang duplikat dan membatasi jumlah", () => {
    const hasil = normalizeKeywordList(
      ["Kopi", "kopi", "gula", "susu", "es", "sirup", "roti", "keju", "teh", "kue"],
      8
    );
    expect(hasil).not.toContain("Kopi");
    expect(hasil.filter((k) => k === "kopi")).toHaveLength(1);
    expect(hasil.length).toBeLessThanOrEqual(8);
  });

  it("bukan array → daftar kosong", () => {
    expect(normalizeKeywordList("kopi")).toEqual([]);
  });
});

describe("aggregateKeywords", () => {
  it("memisahkan total kemunculan dari jumlah percakapan", () => {
    // "kopi" muncul 3x tapi hanya di 2 percakapan — pengulangan satu orang
    // tidak boleh terlihat seperti keluhan banyak orang.
    const hasil = aggregateKeywords([
      { keywords: ["kopi", "kopi", "gula"] },
      { keywords: ["kopi", "antri"] },
    ]);
    const kopi = hasil.find((k) => k.keyword === "kopi");
    expect(kopi).toEqual({ keyword: "kopi", count: 3, conversations: 2 });
  });

  it("diurutkan dari yang paling banyak percakapannya", () => {
    const hasil = aggregateKeywords([
      { keywords: ["antri"] },
      { keywords: ["antri", "parkir"] },
      { keywords: ["antri"] },
    ]);
    expect(hasil[0].keyword).toBe("antri");
    expect(hasil[0].conversations).toBe(3);
  });

  it("stopword dari model tetap tersaring saat agregasi", () => {
    const hasil = aggregateKeywords([{ keywords: ["yang", "terima kasih", "parkir"] }]);
    expect(hasil.map((k) => k.keyword)).toEqual(["parkir"]);
  });

  it("menghormati limit", () => {
    const insights = [{ keywords: ["satu-x", "dua-x", "tiga-x", "empat-x"] }];
    expect(aggregateKeywords(insights, 2)).toHaveLength(2);
  });
});

describe("topicDistribution & sentimentBreakdown", () => {
  it("menghitung topik terbanyak lebih dulu", () => {
    const hasil = topicDistribution([
      { topic: "Keluhan Pengiriman" },
      { topic: "keluhan pengiriman" },
      { topic: "tanya harga" },
      { topic: "" },
    ]);
    expect(hasil[0]).toEqual({ topic: "keluhan pengiriman", count: 2 });
    expect(hasil).toHaveLength(2);
  });

  it("sentimen di luar daftar tidak dihitung", () => {
    expect(
      sentimentBreakdown([
        { sentiment: "positif" },
        { sentiment: "negatif" },
        { sentiment: "negatif" },
        { sentiment: "marah" as never },
      ])
    ).toEqual({ positif: 1, netral: 0, negatif: 2 });
  });
});

describe("transcriptToText", () => {
  const percakapan: TranscriptMessage[] = [
    { direction: "in", body: "Pesanan saya belum datang" },
    { direction: "out", body: "Mohon maaf, kami cek dulu" },
    { direction: "in", body: "  " },
  ];

  it("memberi label peran dan membuang pesan kosong", () => {
    expect(transcriptToText(percakapan)).toBe(
      "Pelanggan: Pesanan saya belum datang\nAgen: Mohon maaf, kami cek dulu"
    );
  });

  it("percakapan panjang dipotong di tengah, awal & akhir dipertahankan", () => {
    const panjang: TranscriptMessage[] = Array.from({ length: 200 }, (_, i) => ({
      direction: i % 2 === 0 ? "in" : "out",
      body: `pesan nomor ${i} ${"x".repeat(50)}`,
    }));
    const hasil = transcriptToText(panjang, 1000);
    expect(hasil.length).toBeLessThanOrEqual(1000);
    expect(hasil).toContain("dipotong");
    expect(hasil).toContain("pesan nomor 0");
    expect(hasil).toContain("pesan nomor 199");
  });
});

describe("buildAnalysisMessages", () => {
  it("mengirim system + user, dan meminta JSON tanpa pagar kode", () => {
    const messages = buildAnalysisMessages([{ direction: "in", body: "halo" }]);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("JSON");
    expect(messages[1].content).toContain("Pelanggan: halo");
  });
});

describe("parseInsight", () => {
  it("membaca JSON yang benar", () => {
    const hasil = parseInsight(
      '{"summary":"Pelanggan menanyakan status pesanan.","topic":"Status Pesanan","sentiment":"negatif","is_complaint":true,"keywords":["pesanan belum datang","pengiriman"]}'
    );
    expect(hasil).toEqual({
      summary: "Pelanggan menanyakan status pesanan.",
      topic: "status pesanan",
      sentiment: "negatif",
      is_complaint: true,
      keywords: ["pesanan belum datang", "pengiriman"],
    });
  });

  it("tahan pagar kode ```json yang ditambahkan model", () => {
    const hasil = parseInsight('```json\n{"summary":"Ringkas.","topic":"tanya harga"}\n```');
    expect(hasil?.topic).toBe("tanya harga");
    expect(hasil?.sentiment).toBe("netral");
  });

  it("sentimen asing jatuh ke netral, is_complaint non-boolean jadi false", () => {
    const hasil = parseInsight('{"summary":"a","topic":"b","sentiment":"kesal","is_complaint":"ya"}');
    expect(hasil?.sentiment).toBe("netral");
    expect(hasil?.is_complaint).toBe(false);
  });

  it("topic kosong diberi nilai jelas, bukan string kosong", () => {
    expect(parseInsight('{"summary":"a"}')?.topic).toBe("tidak jelas");
  });

  it("bukan JSON objek → null (dianggap gagal, boleh dicoba lagi)", () => {
    expect(parseInsight("maaf saya tidak bisa")).toBeNull();
    expect(parseInsight("[1,2]")).toBeNull();
    expect(parseInsight("")).toBeNull();
    expect(parseInsight(null)).toBeNull();
  });
});

describe("fingerprintTranscript", () => {
  const a: TranscriptMessage[] = [{ direction: "in", body: "halo" }];

  it("stabil untuk isi yang sama", () => {
    expect(fingerprintTranscript(a)).toBe(fingerprintTranscript([{ direction: "in", body: "halo" }]));
  });

  it("berubah saat ada pesan baru atau isi berbeda", () => {
    expect(fingerprintTranscript(a)).not.toBe(
      fingerprintTranscript([...a, { direction: "out", body: "hai" }])
    );
    expect(fingerprintTranscript(a)).not.toBe(fingerprintTranscript([{ direction: "in", body: "halox" }]));
  });

  it("arah pesan ikut diperhitungkan", () => {
    expect(fingerprintTranscript(a)).not.toBe(fingerprintTranscript([{ direction: "out", body: "halo" }]));
  });
});

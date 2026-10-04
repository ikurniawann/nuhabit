import { describe, expect, it } from "vitest";
import { fingerprintTranscript } from "@/lib/conversation-analytics";
import {
  DEFAULT_PENDING_LIMIT,
  MAX_PENDING_LIMIT,
  buildInsightReport,
  buildReportSheets,
  clampPendingLimit,
  needsAnalysis,
  normalizeDirection,
  reportFileName,
  summarizeBatch,
  toTranscriptMessages,
  type AggregatableInsight,
  type AnalyzeResult,
  type StoredInsight,
} from "@/lib/crm/conversation-insights";

/**
 * EPIC-029 — uji logika murni analitik percakapan.
 * Lib bersama `@/lib/conversation-analytics` punya suitenya sendiri; di sini
 * yang diuji adalah lapisan milik aplikasi: pemetaan direction, keputusan
 * cache-hit/miss, dan bentuk baris laporan/export.
 */

describe("normalizeDirection", () => {
  it("memetakan nilai kolom DB apa adanya", () => {
    // Arrange + Act + Assert
    expect(normalizeDirection("in")).toBe("in");
    expect(normalizeDirection("out")).toBe("out");
  });

  it("menerima ejaan inbound/outbound dari repo wagateway", () => {
    expect(normalizeDirection("inbound")).toBe("in");
    expect(normalizeDirection("incoming")).toBe("in");
    expect(normalizeDirection("received")).toBe("in");
    expect(normalizeDirection("outbound")).toBe("out");
  });

  it("tidak peduli huruf besar/kecil dan spasi", () => {
    expect(normalizeDirection(" IN ")).toBe("in");
    expect(normalizeDirection("Inbound")).toBe("in");
  });

  it("nilai tak dikenal jatuh ke out, bukan in", () => {
    // Menandai pesan agen sebagai suara pelanggan akan membalik sentimen
    // laporan, jadi default-nya harus yang aman.
    expect(normalizeDirection("entahlah")).toBe("out");
    expect(normalizeDirection(null)).toBe("out");
    expect(normalizeDirection(undefined)).toBe("out");
    expect(normalizeDirection(7)).toBe("out");
  });
});

describe("toTranscriptMessages", () => {
  it("memetakan baris DB ke transkrip lib bersama", () => {
    // Arrange
    const rows = [
      { direction: "in", body: "Pesanan saya belum datang", created_at: new Date("2026-07-20T03:00:00.000Z") },
      { direction: "out", body: "Mohon maaf, kami cek dulu ya", created_at: new Date("2026-07-20T03:05:00.000Z") },
    ];

    // Act
    const transcript = toTranscriptMessages(rows);

    // Assert
    expect(transcript).toEqual([
      { direction: "in", body: "Pesanan saya belum datang", at: "2026-07-20T03:00:00.000Z" },
      { direction: "out", body: "Mohon maaf, kami cek dulu ya", at: "2026-07-20T03:05:00.000Z" },
    ]);
  });

  it("membuang pesan tanpa isi teks (media/otp) dan merapikan spasi tepi", () => {
    const transcript = toTranscriptMessages([
      { direction: "in", body: null },
      { direction: "in", body: "   " },
      { direction: "in", body: "  halo  " },
      { direction: "out", body: 12345 },
    ]);

    expect(transcript).toHaveLength(1);
    expect(transcript[0]).toEqual({ direction: "in", body: "halo", at: undefined });
  });

  it("created_at berbentuk string tetap dibawa, Date invalid dibuang", () => {
    const transcript = toTranscriptMessages([
      { direction: "in", body: "a", created_at: "2026-07-20T03:00:00.000Z" },
      { direction: "in", body: "b", created_at: new Date("bukan tanggal") },
    ]);

    expect(transcript[0].at).toBe("2026-07-20T03:00:00.000Z");
    expect(transcript[1].at).toBeUndefined();
  });

  it("transkrip kosong untuk percakapan tanpa pesan teks", () => {
    expect(toTranscriptMessages([])).toEqual([]);
    expect(toTranscriptMessages([{ direction: "out", body: null }])).toEqual([]);
  });
});

describe("needsAnalysis (keputusan cache-hit / cache-miss)", () => {
  const fingerprint = "3-abc123";

  it("cache-miss bila belum ada insight tersimpan", () => {
    expect(needsAnalysis(null, fingerprint)).toBe(true);
    expect(needsAnalysis(undefined, fingerprint)).toBe(true);
  });

  it("cache-HIT bila sidik jari sama — inilah penekan biaya token", () => {
    expect(needsAnalysis({ fingerprint }, fingerprint)).toBe(false);
  });

  it("cache-miss bila sidik jari berbeda (ada pesan baru)", () => {
    expect(needsAnalysis({ fingerprint: "2-zzz999" }, fingerprint)).toBe(true);
  });

  it("cache-miss bila sidik jari tersimpan kosong (baris lama/rusak)", () => {
    expect(needsAnalysis({ fingerprint: "" }, fingerprint)).toBe(true);
  });

  it("terhubung nyata dengan fingerprintTranscript: pesan baru = analisa ulang", () => {
    // Arrange
    const awal = toTranscriptMessages([{ direction: "in", body: "stok ada?" }]);
    const stored: Pick<StoredInsight, "fingerprint"> = {
      fingerprint: fingerprintTranscript(awal),
    };

    // Act
    const setelahPesanBaru = toTranscriptMessages([
      { direction: "in", body: "stok ada?" },
      { direction: "out", body: "ada kak" },
    ]);

    // Assert
    expect(needsAnalysis(stored, fingerprintTranscript(awal))).toBe(false);
    expect(needsAnalysis(stored, fingerprintTranscript(setelahPesanBaru))).toBe(true);
  });
});

describe("summarizeBatch", () => {
  it("menghitung tiap status batch", () => {
    // Arrange
    const results: AnalyzeResult[] = [
      { conversation_id: "a", status: "analyzed", insight: null },
      { conversation_id: "b", status: "cache", insight: null },
      { conversation_id: "c", status: "cache", insight: null },
      { conversation_id: "d", status: "empty", insight: null },
      { conversation_id: "e", status: "failed", insight: null, error: "HTTP 429" },
    ];

    // Act
    const summary = summarizeBatch(results);

    // Assert
    expect(summary).toEqual({ requested: 5, analyzed: 1, cached: 2, empty: 1, failed: 1 });
  });

  it("batch kosong menghasilkan nol semua", () => {
    expect(summarizeBatch([])).toEqual({
      requested: 0,
      analyzed: 0,
      cached: 0,
      empty: 0,
      failed: 0,
    });
  });
});

describe("clampPendingLimit", () => {
  it("meneruskan nilai wajar apa adanya", () => {
    expect(clampPendingLimit(10)).toBe(10);
    expect(clampPendingLimit("15")).toBe(15);
  });

  it("nilai tak masuk akal jatuh ke default, bukan error", () => {
    expect(clampPendingLimit(undefined)).toBe(DEFAULT_PENDING_LIMIT);
    expect(clampPendingLimit(null)).toBe(DEFAULT_PENDING_LIMIT);
    expect(clampPendingLimit(0)).toBe(DEFAULT_PENDING_LIMIT);
    expect(clampPendingLimit(-5)).toBe(DEFAULT_PENDING_LIMIT);
    expect(clampPendingLimit("banyak")).toBe(DEFAULT_PENDING_LIMIT);
    expect(clampPendingLimit(Number.NaN)).toBe(DEFAULT_PENDING_LIMIT);
    expect(clampPendingLimit(Number.POSITIVE_INFINITY)).toBe(DEFAULT_PENDING_LIMIT);
  });

  it("membatasi borongan tak terbatas ke MAX_PENDING_LIMIT", () => {
    expect(clampPendingLimit(5000)).toBe(MAX_PENDING_LIMIT);
  });

  it("membulatkan ke bawah agar LIMIT SQL selalu bilangan bulat", () => {
    expect(clampPendingLimit(7.9)).toBe(7);
  });
});

describe("buildInsightReport", () => {
  const insights: AggregatableInsight[] = [
    {
      topic: "keluhan pengiriman",
      sentiment: "negatif",
      is_complaint: true,
      keywords: ["pengiriman", "terlambat"],
    },
    {
      topic: "keluhan pengiriman",
      sentiment: "negatif",
      is_complaint: true,
      keywords: ["pengiriman", "paket rusak"],
    },
    {
      topic: "tanya harga",
      sentiment: "netral",
      is_complaint: false,
      keywords: ["harga", "tiket"],
    },
  ];

  it("menyusun ringkasan, kata kunci, dan topik dari insight", () => {
    // Act
    const report = buildInsightReport(insights, {
      period: { from: "2026-07-01", to: "2026-07-25" },
      totalConversations: 10,
    });

    // Assert
    expect(report.period).toEqual({ from: "2026-07-01", to: "2026-07-25" });
    expect(report.summary.total_conversations).toBe(10);
    expect(report.summary.analyzed).toBe(3);
    expect(report.summary.not_analyzed).toBe(7);
    expect(report.summary.complaints).toBe(2);
    expect(report.summary.sentiment).toEqual({ positif: 0, netral: 1, negatif: 2 });
    expect(report.keywords[0]).toEqual({ keyword: "pengiriman", count: 2, conversations: 2 });
    expect(report.topics[0]).toEqual({ topic: "keluhan pengiriman", count: 2 });
  });

  it("belum_dianalisa tidak pernah negatif walau total lebih kecil", () => {
    const report = buildInsightReport(insights, {
      period: { from: "2026-07-01", to: "2026-07-25" },
      totalConversations: 1,
    });

    expect(report.summary.not_analyzed).toBe(0);
  });

  it("menghormati batas jumlah kata kunci dan topik", () => {
    const report = buildInsightReport(insights, {
      period: { from: "2026-07-01", to: "2026-07-25" },
      totalConversations: 3,
      keywordLimit: 1,
      topicLimit: 1,
    });

    expect(report.keywords).toHaveLength(1);
    expect(report.topics).toHaveLength(1);
  });

  it("tanpa insight: laporan tetap terbentuk dengan nol", () => {
    const report = buildInsightReport([], {
      period: { from: "2026-07-01", to: "2026-07-25" },
      totalConversations: 4,
    });

    expect(report.summary.analyzed).toBe(0);
    expect(report.summary.not_analyzed).toBe(4);
    expect(report.summary.complaints).toBe(0);
    expect(report.keywords).toEqual([]);
    expect(report.topics).toEqual([]);
  });
});

describe("buildReportSheets (export XLSX)", () => {
  const report = buildInsightReport(
    [
      {
        topic: "keluhan pengiriman",
        sentiment: "negatif",
        is_complaint: true,
        keywords: ["pengiriman"],
      },
    ],
    { period: { from: "2026-07-01", to: "2026-07-25" }, totalConversations: 2 }
  );

  it("menghasilkan tepat tiga sheet dengan nama yang diminta", () => {
    // Act
    const sheets = buildReportSheets(report);

    // Assert
    expect(sheets.map((sheet) => sheet.name)).toEqual(["Ringkasan", "Kata Kunci", "Topik"]);
    // Batas format XLSX untuk nama sheet.
    for (const sheet of sheets) expect(sheet.name.length).toBeLessThanOrEqual(31);
  });

  it("sheet Ringkasan memuat periode dan angka utama", () => {
    const [ringkasan] = buildReportSheets(report);

    expect(ringkasan.rows[1]).toEqual(["Periode", "2026-07-01 s/d 2026-07-25"]);
    expect(ringkasan.rows).toContainEqual(["Percakapan pada periode", 2]);
    expect(ringkasan.rows).toContainEqual(["Sudah dianalisa", 1]);
    expect(ringkasan.rows).toContainEqual(["Terindikasi komplain", 1]);
    expect(ringkasan.rows).toContainEqual(["Sentimen negatif", 1]);
  });

  it("sheet Kata Kunci & Topik berheader dan berisi barisnya", () => {
    const [, kataKunci, topik] = buildReportSheets(report);

    expect(kataKunci.rows[0]).toEqual(["Kata Kunci", "Jumlah Percakapan", "Total Kemunculan"]);
    expect(kataKunci.rows[1]).toEqual(["pengiriman", 1, 1]);
    expect(topik.rows[0]).toEqual(["Topik", "Jumlah Percakapan"]);
    expect(topik.rows[1]).toEqual(["keluhan pengiriman", 1]);
  });

  it("tidak ada sel yang memuat PII percakapan (isi chat/nomor/nama)", () => {
    // Laporan agregat wajib bebas PII — ringkasan per percakapan tidak boleh
    // ikut ter-export. Bentuk barisnya dijaga hanya label + angka.
    const teks = buildReportSheets(report)
      .flatMap((sheet) => sheet.rows.flat())
      .filter((cell): cell is string => typeof cell === "string");

    expect(teks.some((cell) => /\+?\d{9,}/.test(cell))).toBe(false);
  });
});

describe("reportFileName", () => {
  it("bertanggal agar unduhan tidak saling menimpa", () => {
    expect(reportFileName({ from: "2026-07-01", to: "2026-07-25" })).toBe(
      "analitik-percakapan-2026-07-01_2026-07-25.xlsx"
    );
  });
});

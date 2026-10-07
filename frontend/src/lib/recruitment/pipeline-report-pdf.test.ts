import { describe, expect, test } from "vitest";
import { buildPipelineReportPdf } from "./pipeline-report-pdf";
import type { PipelineReportData } from "./pipeline-report";

const baseData: PipelineReportData = {
  candidate: {
    id: "6f9619ff-8b86-d011-b42d-00c04fc964ff",
    full_name: "Budi Santoso",
    email: "budi@example.com",
    phone: "0812345678",
    domicile: "Bandung",
    source: "JobStreet",
    status: "offer",
    last_experience: "Kasir 2 tahun",
    last_education: "SMA",
    expected_salary: "4500000",
    created_at: "2026-07-01T03:00:00Z",
    position_title: "Kasir",
  },
  aiAnalysis: {
    match_score: 82,
    match_reason: "Pengalaman kasir relevan",
    summary: "Kandidat berpengalaman di ritel.",
    model: "deepseek-chat",
    updated_at: "2026-07-01T04:00:00Z",
  },
  screening: {
    contacted: true,
    interested: true,
    availability_note: "Bisa mulai bulan depan",
    confirmed_salary: "4200000",
    willing_shift: true,
    willing_placement: false,
    notes: "Komunikatif",
    recommendation: "lolos",
    updated_by_name: "HRD Satu",
    updated_at: "2026-07-02T04:00:00Z",
  },
  psikotesTests: [
    {
      session_id: "s1",
      session_status: "completed",
      session_completed_at: "2026-07-03T04:00:00Z",
      instrument_name: "Tes Logika",
      status: "selesai",
      score: "78",
      review_notes: null,
      reviewed_by_name: null,
      ai_insight: null,
    },
    {
      session_id: "s1",
      session_status: "completed",
      session_completed_at: "2026-07-03T04:00:00Z",
      instrument_name: "Tes Baum",
      status: "reviewed",
      score: null,
      review_notes: "Gambar proporsional",
      reviewed_by_name: "HRD Satu",
      ai_insight: {
        observation: "Pohon digambar besar di tengah kertas dengan batang tebal.",
        observation_source: "ai",
        vision_model: "gpt-4o-mini",
        insight: {
          ringkasan: "Kandidat cenderung percaya diri dan stabil.",
          indikasi: [
            {
              aspek: "Ukuran & posisi",
              insight: "Gambar besar di tengah mengindikasikan kepercayaan diri.",
            },
            {
              aspek: "Batang",
              insight: "Batang tebal cenderung menunjukkan stabilitas emosi.",
            },
          ],
          perhatikan_saat_interview: [
            "Gali contoh nyata pengambilan keputusan di bawah tekanan.",
          ],
          keterbatasan:
            "Interpretasi indikatif dari observasi terbatas, bukan diagnosis psikologis.",
        },
        model: "deepseek-chat",
        created_at: "2026-07-03T05:00:00Z",
        created_by_name: "HRD Satu",
      },
    },
  ],
  psikotesSummary: {
    recommendation: "lolos",
    notes: "Skor di atas rata-rata",
    updated_by_name: "HRD Satu",
    updated_at: "2026-07-03T06:00:00Z",
  },
  interviews: [
    {
      status: "completed",
      invited_at: "2026-07-04T02:00:00Z",
      completed_at: "2026-07-04T03:00:00Z",
      summary_model: "deepseek-chat",
      turn_count: "8",
      ai_summary: {
        ringkasan: "Kandidat menjawab lancar.",
        relevansi: { skor: 80, kesimpulan: "relevan", alasan: "Pengalaman sesuai" },
        keahlian: ["Kasir", "Pelayanan pelanggan"],
        ekspektasi_gaji: { disebutkan: true, nilai: "Rp 4,5 juta", catatan: "" },
        red_flags: [],
        perhatikan_saat_interview_lanjutan: [],
        keterbatasan: "",
      },
    },
  ],
  offers: [
    {
      version: 1,
      status: "sent",
      position_title: "Kasir",
      base_salary: "4300000",
      start_date: "2026-08-01",
      sent_at: "2026-07-05T03:00:00Z",
      expires_at: "2026-07-12T03:00:00Z",
      responded_at: null,
      response_note: null,
      created_by_name: "HRD Satu",
    },
  ],
  hired: null,
  activities: [
    {
      activity_type: "stage_changed",
      description: "Status berubah ke Offer",
      created_by_name: "HRD Satu",
      created_at: "2026-07-05T03:00:00Z",
    },
  ],
};

/** Hitung jumlah halaman dari objek /Type /Page (bukan /Pages) di PDF mentah. */
function countPages(pdf: Buffer): number {
  return (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

describe("buildPipelineReportPdf", () => {
  test("produces a valid PDF buffer from complete pipeline data", async () => {
    // Act
    const pdf = await buildPipelineReportPdf(baseData);

    // Assert
    expect(pdf.length).toBeGreaterThan(1000);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  test("does not emit extra blank pages from the footer pass", async () => {
    // Arrange — data ringkas yang muat di satu halaman
    const sparse: PipelineReportData = {
      ...baseData,
      psikotesTests: [],
      interviews: [],
      offers: [],
      activities: [],
    };

    // Act
    const pdf = await buildPipelineReportPdf(sparse);

    // Assert — regresi lama: footer di area margin memicu halaman kosong ekstra
    expect(countPages(pdf)).toBeLessThanOrEqual(2);
  });

  test("handles a candidate with empty per-stage data (no crash)", async () => {
    // Arrange
    const sparse: PipelineReportData = {
      ...baseData,
      aiAnalysis: null,
      screening: null,
      psikotesTests: [],
      psikotesSummary: null,
      interviews: [],
      offers: [],
      activities: [],
    };

    // Act
    const pdf = await buildPipelineReportPdf(sparse);

    // Assert
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  test("renders psikotes AI insight section when present", async () => {
    // Arrange — baseData sudah memuat satu tes drawing dengan ai_insight;
    // versi tanpa insight jadi pembanding ukuran output
    const withoutInsight: PipelineReportData = {
      ...baseData,
      psikotesTests: baseData.psikotesTests.map((t) => ({ ...t, ai_insight: null })),
    };

    // Act
    const withInsight = await buildPipelineReportPdf(baseData);
    const plain = await buildPipelineReportPdf(withoutInsight);

    // Assert — PDF valid dan konten insight menambah ukuran dokumen
    expect(withInsight.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(withInsight.length).toBeGreaterThan(plain.length);
  });

  test("renders hired section with employee data for hired candidate", async () => {
    // Arrange
    const hiredData: PipelineReportData = {
      ...baseData,
      candidate: { ...baseData.candidate, status: "hired" },
      hired: {
        promotion_date: "2026-07-20",
        nip: "EMP-2026-00042",
        join_date: "2026-08-01",
        employment_status: "probation",
        is_active: true,
        has_account: true,
        department_name: "Operasional",
        job_title: "Kasir",
        reporting_to_name: "Manajer Toko",
        onboarding_total: 8,
        onboarding_completed: 5,
      },
    };

    // Act
    const withHired = await buildPipelineReportPdf(hiredData);
    const plain = await buildPipelineReportPdf(baseData);

    // Assert — PDF valid dan data hired menambah ukuran dokumen
    expect(withHired.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(withHired.length).toBeGreaterThan(plain.length);
  });

  test("handles hired candidate not yet promoted to employee (no crash)", async () => {
    // Arrange — status hired tapi belum ada record karyawan
    const notPromoted: PipelineReportData = {
      ...baseData,
      candidate: { ...baseData.candidate, status: "hired" },
      hired: null,
    };

    // Act
    const pdf = await buildPipelineReportPdf(notPromoted);

    // Assert
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  test("handles many activities across page breaks", async () => {
    // Arrange
    const busy: PipelineReportData = {
      ...baseData,
      activities: Array.from({ length: 120 }, (_, i) => ({
        activity_type: "note",
        description: `Aktivitas ke-${i + 1}: catatan panjang untuk menguji pemenggalan halaman otomatis pada laporan PDF pipeline kandidat.`,
        created_by_name: "HRD Satu",
        created_at: "2026-07-05T03:00:00Z",
      })),
    };

    // Act
    const pdf = await buildPipelineReportPdf(busy);

    // Assert
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(5000);
  });
});

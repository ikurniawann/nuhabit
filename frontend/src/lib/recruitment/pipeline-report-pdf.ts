import PDFDocument from "pdfkit";
import type { PipelineReportData, ReportPsikotesAiInsight } from "./pipeline-report";
import {
  boolLabel,
  EMPLOYMENT_STATUS_LABELS,
  formatDate,
  formatDateTime,
  formatIdr,
  formatScore,
  labelOf,
  OBSERVATION_SOURCE_LABELS,
  OFFER_STATUS_LABELS,
  PIPELINE_STATUS_LABELS,
  PSIKOTES_TEST_STATUS_LABELS,
  RECOMMENDATION_LABELS,
  RELEVANSI_LABELS,
} from "./pipeline-report-format";

/**
 * Render laporan perjalanan pipeline kandidat menjadi PDF (Buffer).
 * Dipakai route GET /api/candidates/[id]/report — file tidak disimpan,
 * digenerate on-the-fly supaya selalu mengikuti data terbaru.
 */

const COLOR_TEXT = "#1f2937";
const COLOR_MUTED = "#6b7280";
const COLOR_ACCENT = "#0369a1";
const COLOR_LINE = "#e5e7eb";

type Doc = InstanceType<typeof PDFDocument>;

/**
 * Font standar PDF (Helvetica/WinAnsi) tidak punya glyph di luar Latin-1 —
 * karakter seperti "→" tampil rusak. Petakan yang umum, buang sisanya.
 */
const NON_WINANSI_MAP: Record<string, string> = {
  "→": "->",
  "←": "<-",
  "✔": "v",
  "✖": "x",
};

function sanitizeText(text: string): string {
  return text
    .replace(/[←→✔✖]/g, (ch) => NON_WINANSI_MAP[ch] ?? "")
    .replace(/[’‘‚]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[^\x00-\xFF–—•…]/g, "");
}

function sectionTitle(doc: Doc, title: string) {
  ensureSpace(doc, 60);
  doc.moveDown(1);
  doc.fillColor(COLOR_ACCENT).fontSize(12).font("Helvetica-Bold").text(title);
  const y = doc.y + 2;
  doc
    .moveTo(doc.page.margins.left, y)
    .lineTo(doc.page.width - doc.page.margins.right, y)
    .strokeColor(COLOR_LINE)
    .lineWidth(0.8)
    .stroke();
  doc.moveDown(0.5);
  doc.fillColor(COLOR_TEXT).fontSize(9.5).font("Helvetica");
}

function keyValue(doc: Doc, label: string, value: string) {
  ensureSpace(doc, 16);
  const x = doc.page.margins.left;
  const labelWidth = 150;
  const valueWidth =
    doc.page.width - doc.page.margins.left - doc.page.margins.right - labelWidth;
  const y = doc.y;
  doc.font("Helvetica").fillColor(COLOR_MUTED).text(label, x, y, { width: labelWidth });
  doc
    .font("Helvetica")
    .fillColor(COLOR_TEXT)
    .text(sanitizeText(value) || "-", x + labelWidth, y, { width: valueWidth });
  doc.x = x;
  doc.moveDown(0.2);
}

function paragraph(doc: Doc, text: string) {
  ensureSpace(doc, 24);
  doc.font("Helvetica").fillColor(COLOR_TEXT).text(sanitizeText(text), { lineGap: 1.5 });
  doc.moveDown(0.3);
}

function bullets(doc: Doc, items: string[]) {
  for (const item of items) {
    ensureSpace(doc, 14);
    doc
      .font("Helvetica")
      .fillColor(COLOR_TEXT)
      .text(`•  ${sanitizeText(item)}`, { indent: 8, lineGap: 1.5 });
  }
  doc.moveDown(0.3);
}

function emptyNote(doc: Doc, text: string) {
  doc.font("Helvetica-Oblique").fillColor(COLOR_MUTED).text(text);
  doc.font("Helvetica").fillColor(COLOR_TEXT);
  doc.moveDown(0.3);
}

/** Tambah halaman baru bila ruang tersisa kurang dari `needed` pt. */
function ensureSpace(doc: Doc, needed: number) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + needed > bottom) doc.addPage();
}

/** Blok "Analisa AI" per tes drawing pada bagian Psikotes. */
function psikotesAiInsight(doc: Doc, ai: ReportPsikotesAiInsight) {
  ensureSpace(doc, 40);
  doc.moveDown(0.2);
  doc.font("Helvetica-Bold").fillColor(COLOR_ACCENT).text("Analisa AI");
  doc.font("Helvetica").fillColor(COLOR_TEXT);
  keyValue(
    doc,
    "Observasi gambar",
    `${ai.observation} (${labelOf(OBSERVATION_SOURCE_LABELS, ai.observation_source ?? "manual")})`
  );
  if (ai.insight.ringkasan) keyValue(doc, "Ringkasan", ai.insight.ringkasan);
  if (ai.insight.indikasi.length > 0) {
    ensureSpace(doc, 20);
    doc.font("Helvetica-Bold").text("Indikasi:");
    doc.font("Helvetica");
    bullets(
      doc,
      ai.insight.indikasi.map((item) => `${item.aspek}: ${item.insight}`)
    );
  }
  if (ai.insight.perhatikan_saat_interview.length > 0) {
    ensureSpace(doc, 20);
    doc.font("Helvetica-Bold").text("Perhatikan saat interview:");
    doc.font("Helvetica");
    bullets(doc, ai.insight.perhatikan_saat_interview);
  }
  if (ai.insight.keterbatasan) {
    ensureSpace(doc, 16);
    doc
      .font("Helvetica-Oblique")
      .fillColor(COLOR_MUTED)
      .text(sanitizeText(ai.insight.keterbatasan), { lineGap: 1.5 });
    doc.font("Helvetica").fillColor(COLOR_TEXT);
  }
  keyValue(
    doc,
    "Model / waktu analisa",
    `${ai.model}${ai.vision_model ? ` + ${ai.vision_model}` : ""} · ${formatDateTime(ai.created_at)}`
  );
}

export async function buildPipelineReportPdf(data: PipelineReportData): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 48, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const { candidate } = data;

  // ── Header ────────────────────────────────────────────────────────────
  doc.fillColor(COLOR_TEXT).font("Helvetica-Bold").fontSize(16);
  doc.text("Laporan Pipeline Rekrutmen");
  doc.moveDown(0.15);
  doc.font("Helvetica").fontSize(10).fillColor(COLOR_MUTED);
  doc.text(
    sanitizeText(
      `${candidate.full_name} — ${candidate.position_title ?? "Posisi tidak tercatat"}`
    )
  );
  doc.text(
    `Status saat ini: ${labelOf(PIPELINE_STATUS_LABELS, candidate.status)} · Dicetak ${formatDateTime(new Date())}`
  );
  doc.fontSize(9.5).fillColor(COLOR_TEXT);

  // ── 1. Profil kandidat ────────────────────────────────────────────────
  sectionTitle(doc, "1. Profil Kandidat");
  keyValue(doc, "Nama lengkap", candidate.full_name);
  keyValue(doc, "Email", candidate.email ?? "-");
  keyValue(doc, "Telepon", candidate.phone ?? "-");
  keyValue(doc, "Domisili", candidate.domicile ?? "-");
  keyValue(doc, "Sumber lamaran", candidate.source ?? "-");
  keyValue(doc, "Pendidikan terakhir", candidate.last_education ?? "-");
  keyValue(doc, "Pengalaman terakhir", candidate.last_experience ?? "-");
  keyValue(doc, "Ekspektasi gaji", formatIdr(candidate.expected_salary));
  keyValue(doc, "Tanggal melamar", formatDate(candidate.created_at));

  // ── 2. Analisis CV (AI) — tahap Applied ──────────────────────────────
  sectionTitle(doc, "2. Analisis CV (AI) — Tahap Applied");
  if (data.aiAnalysis) {
    keyValue(doc, "Skor kecocokan", formatScore(data.aiAnalysis.match_score));
    if (data.aiAnalysis.match_reason) keyValue(doc, "Alasan", data.aiAnalysis.match_reason);
    if (data.aiAnalysis.summary) keyValue(doc, "Ringkasan profil", data.aiAnalysis.summary);
    keyValue(
      doc,
      "Model / waktu analisis",
      `${data.aiAnalysis.model ?? "-"} · ${formatDateTime(data.aiAnalysis.updated_at)}`
    );
  } else {
    emptyNote(doc, "Belum ada analisis AI untuk kandidat ini.");
  }

  // ── 3. Screening HR ───────────────────────────────────────────────────
  sectionTitle(doc, "3. Screening HR");
  if (data.screening) {
    keyValue(doc, "Sudah dihubungi", boolLabel(data.screening.contacted));
    keyValue(doc, "Berminat", boolLabel(data.screening.interested));
    keyValue(doc, "Ketersediaan", data.screening.availability_note ?? "-");
    keyValue(doc, "Gaji terkonfirmasi", formatIdr(data.screening.confirmed_salary));
    keyValue(doc, "Bersedia shift", boolLabel(data.screening.willing_shift));
    keyValue(doc, "Bersedia penempatan", boolLabel(data.screening.willing_placement));
    if (data.screening.notes) keyValue(doc, "Catatan", data.screening.notes);
    keyValue(
      doc,
      "Rekomendasi",
      labelOf(RECOMMENDATION_LABELS, data.screening.recommendation)
    );
    keyValue(
      doc,
      "Diperbarui oleh",
      `${data.screening.updated_by_name ?? "-"} · ${formatDateTime(data.screening.updated_at)}`
    );
  } else {
    emptyNote(doc, "Tahap screening belum diisi.");
  }

  // ── 4. Psikotes ───────────────────────────────────────────────────────
  sectionTitle(doc, "4. Psikotes");
  if (data.psikotesTests.length > 0) {
    for (const test of data.psikotesTests) {
      ensureSpace(doc, 30);
      doc.font("Helvetica-Bold").text(sanitizeText(test.instrument_name));
      doc.font("Helvetica");
      keyValue(doc, "Status", labelOf(PSIKOTES_TEST_STATUS_LABELS, test.status));
      keyValue(doc, "Skor", formatScore(test.score));
      if (test.review_notes) keyValue(doc, "Catatan review", test.review_notes);
      if (test.reviewed_by_name) keyValue(doc, "Direview oleh", test.reviewed_by_name);
      if (test.ai_insight) psikotesAiInsight(doc, test.ai_insight);
      doc.moveDown(0.3);
    }
  } else {
    emptyNote(doc, "Belum ada sesi psikotes.");
  }
  if (data.psikotesSummary) {
    doc.font("Helvetica-Bold").text("Kesimpulan Psikotes");
    doc.font("Helvetica");
    keyValue(
      doc,
      "Rekomendasi",
      labelOf(RECOMMENDATION_LABELS, data.psikotesSummary.recommendation)
    );
    if (data.psikotesSummary.notes) keyValue(doc, "Catatan", data.psikotesSummary.notes);
    keyValue(
      doc,
      "Diputuskan oleh",
      `${data.psikotesSummary.updated_by_name ?? "-"} · ${formatDateTime(data.psikotesSummary.updated_at)}`
    );
  }

  // ── 5. Interview AI ───────────────────────────────────────────────────
  sectionTitle(doc, "5. Interview AI");
  if (data.interviews.length > 0) {
    data.interviews.forEach((session, index) => {
      ensureSpace(doc, 40);
      if (data.interviews.length > 1) {
        doc.font("Helvetica-Bold").text(`Sesi ${index + 1}`);
        doc.font("Helvetica");
      }
      keyValue(doc, "Status sesi", session.status);
      keyValue(doc, "Selesai pada", formatDateTime(session.completed_at));
      keyValue(doc, "Pertanyaan terjawab", session.turn_count);
      const summary = session.ai_summary;
      if (summary) {
        if (summary.ringkasan) keyValue(doc, "Ringkasan", summary.ringkasan);
        if (summary.relevansi) {
          keyValue(
            doc,
            "Relevansi",
            `${formatScore(summary.relevansi.skor)} — ${labelOf(RELEVANSI_LABELS, summary.relevansi.kesimpulan)}`
          );
          if (summary.relevansi.alasan) keyValue(doc, "Alasan", summary.relevansi.alasan);
        }
        if (summary.keahlian?.length) keyValue(doc, "Keahlian", summary.keahlian.join(", "));
        if (summary.ekspektasi_gaji?.disebutkan) {
          keyValue(
            doc,
            "Ekspektasi gaji (interview)",
            summary.ekspektasi_gaji.nilai ?? summary.ekspektasi_gaji.catatan ?? "-"
          );
        }
        if (summary.red_flags?.length) {
          ensureSpace(doc, 20);
          doc.font("Helvetica-Bold").text("Red flags:");
          doc.font("Helvetica");
          bullets(doc, summary.red_flags);
        }
      } else {
        emptyNote(doc, "Sesi belum memiliki kesimpulan AI.");
      }
      doc.moveDown(0.3);
    });
  } else {
    emptyNote(doc, "Belum ada sesi interview AI.");
  }

  // ── 6. Offer ──────────────────────────────────────────────────────────
  sectionTitle(doc, "6. Offer");
  if (data.offers.length > 0) {
    for (const offer of data.offers) {
      ensureSpace(doc, 40);
      doc
        .font("Helvetica-Bold")
        .text(`Offer v${offer.version} — ${labelOf(OFFER_STATUS_LABELS, offer.status)}`);
      doc.font("Helvetica");
      keyValue(doc, "Posisi", offer.position_title ?? "-");
      keyValue(doc, "Gaji pokok", formatIdr(offer.base_salary));
      keyValue(doc, "Mulai kerja", formatDate(offer.start_date));
      keyValue(doc, "Dikirim", formatDateTime(offer.sent_at));
      keyValue(doc, "Berlaku sampai", formatDateTime(offer.expires_at));
      if (offer.responded_at) keyValue(doc, "Direspons", formatDateTime(offer.responded_at));
      if (offer.response_note) keyValue(doc, "Catatan respons", offer.response_note);
      keyValue(doc, "Dibuat oleh", offer.created_by_name ?? "-");
      doc.moveDown(0.3);
    }
  } else {
    emptyNote(doc, "Belum ada offer yang dibuat.");
  }

  // ── 7. Hired — data karyawan hasil promosi ────────────────────────────
  sectionTitle(doc, "7. Hired — Data Karyawan");
  if (data.hired) {
    keyValue(doc, "NIP", data.hired.nip ?? "-");
    keyValue(doc, "Tanggal promosi", formatDate(data.hired.promotion_date));
    keyValue(doc, "Tanggal bergabung", formatDate(data.hired.join_date));
    keyValue(
      doc,
      "Status kepegawaian",
      labelOf(EMPLOYMENT_STATUS_LABELS, data.hired.employment_status)
    );
    keyValue(doc, "Departemen", data.hired.department_name ?? "-");
    keyValue(doc, "Jabatan", data.hired.job_title ?? "-");
    keyValue(doc, "Atasan langsung", data.hired.reporting_to_name ?? "-");
    keyValue(doc, "Akun login karyawan", data.hired.has_account ? "Sudah dibuat" : "Belum dibuat");
    keyValue(
      doc,
      "Onboarding",
      data.hired.onboarding_total > 0
        ? `${data.hired.onboarding_completed}/${data.hired.onboarding_total} item selesai`
        : "Belum ada checklist onboarding"
    );
    keyValue(doc, "Status karyawan", data.hired.is_active ? "Aktif" : "Nonaktif");
  } else if (candidate.status === "hired") {
    emptyNote(doc, "Kandidat sudah Hired namun belum dipromosikan menjadi karyawan.");
  } else {
    emptyNote(doc, "Kandidat belum berstatus Hired.");
  }

  // ── 8. Riwayat aktivitas pipeline ─────────────────────────────────────
  sectionTitle(doc, "8. Riwayat Aktivitas Pipeline");
  if (data.activities.length > 0) {
    for (const activity of data.activities) {
      ensureSpace(doc, 24);
      doc.fillColor(COLOR_MUTED).fontSize(8.5);
      doc.text(
        sanitizeText(
          `${formatDateTime(activity.created_at)}${activity.created_by_name ? ` · ${activity.created_by_name}` : ""}`
        )
      );
      doc.fillColor(COLOR_TEXT).fontSize(9.5);
      paragraph(doc, activity.description);
    }
  } else {
    emptyNote(doc, "Belum ada aktivitas tercatat.");
  }

  // ── Footer: nomor halaman ─────────────────────────────────────────────
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // nol-kan margin bawah sementara — menulis di area margin memicu
    // addPage otomatis (menghasilkan halaman kosong ekstra)
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .fontSize(8)
      .fillColor(COLOR_MUTED)
      .text(
        sanitizeText(
          `NüHabit HRIS · ${candidate.full_name} · Halaman ${i + 1} dari ${range.count}`
        ),
        doc.page.margins.left,
        doc.page.height - 34,
        {
          width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
          align: "center",
          lineBreak: false,
        }
      );
    doc.page.margins.bottom = bottomMargin;
  }

  doc.end();
  return finished;
}

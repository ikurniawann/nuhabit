import { z } from "zod";
import { PAPI_SCALE_CODES, type PapiScaleCode } from "@/lib/recruitment/psikotes";

/**
 * Validasi modul Psikotes Online (EPIC-002 TG2).
 * Soal divalidasi sesuai `kind` instrumen di route (mcq vs forced_choice);
 * instrumen `drawing` tidak punya bank soal.
 */

const papiScaleEnum = z.enum(PAPI_SCALE_CODES as [PapiScaleCode, ...PapiScaleCode[]]);

export const instrumentConfigSchema = z.object({
  duration_seconds: z
    .number()
    .int("Durasi harus bilangan bulat (detik)")
    .min(30, "Durasi minimal 30 detik")
    .max(14400, "Durasi maksimal 4 jam"),
  question_count: z
    .number()
    .int("Jumlah soal harus bilangan bulat")
    .min(1, "Jumlah soal minimal 1")
    .max(200, "Jumlah soal maksimal 200")
    .nullable()
    .optional(),
  shuffle: z.boolean().optional(),
  instructions: z.string().trim().max(2000, "Instruksi maksimal 2000 karakter").optional(),
});

export const instrumentUpdateSchema = z
  .object({
    name: z.string().trim().min(1, "Nama wajib diisi").max(100, "Nama maksimal 100 karakter").optional(),
    is_active: z.boolean().optional(),
    config: instrumentConfigSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Tidak ada perubahan yang dikirim" });

const mcqOptionKeyEnum = z.enum(["a", "b", "c", "d", "e", "f"]);

const questionBase = {
  sort_order: z
    .number()
    .int("Urutan harus bilangan bulat")
    .min(0, "Urutan tidak boleh negatif")
    .max(10000, "Urutan maksimal 10000")
    .default(0),
  is_active: z.boolean().default(true),
};

export const mcqQuestionSchema = z
  .object({
    body: z.string().trim().min(1, "Soal wajib diisi").max(2000, "Soal maksimal 2000 karakter"),
    options: z
      .array(
        z.object({
          key: mcqOptionKeyEnum,
          text: z.string().trim().min(1, "Teks opsi wajib diisi").max(500, "Teks opsi maksimal 500 karakter"),
        })
      )
      .min(2, "Minimal 2 opsi")
      .max(6, "Maksimal 6 opsi")
      .refine((opts) => new Set(opts.map((o) => o.key)).size === opts.length, {
        message: "Key opsi tidak boleh duplikat",
      }),
    answer_key: z.object({ correct: mcqOptionKeyEnum }),
    ...questionBase,
  })
  .refine((q) => q.options.some((o) => o.key === q.answer_key.correct), {
    message: "Kunci jawaban harus salah satu key opsi",
    path: ["answer_key"],
  });

const papiStatementSchema = z.object({
  text: z.string().trim().min(1, "Pernyataan wajib diisi").max(500, "Pernyataan maksimal 500 karakter"),
  scale: papiScaleEnum,
});

export const papiQuestionSchema = z
  .object({
    // Pasangan PAPI tidak punya stem soal; body opsional utk catatan nomor/seri.
    body: z.string().trim().max(500, "Keterangan maksimal 500 karakter").default(""),
    options: z.object({ a: papiStatementSchema, b: papiStatementSchema }),
    ...questionBase,
  })
  .refine((q) => q.options.a.scale !== q.options.b.scale, {
    message: "Skala pernyataan A dan B tidak boleh sama",
    path: ["options", "b", "scale"],
  });

// ── Endpoint publik sesi kandidat (TG3) ─────────────────────────────────

export const sessionStartSchema = z.object({
  webcam_consent: z.boolean(),
});

/** Autosave jawaban: map question_id (uuid) → pilihan (key opsi / a-b PAPI). */
export const sessionAnswersSchema = z.object({
  answers: z
    .record(z.string().uuid("ID soal tidak valid"), z.string().trim().min(1).max(4))
    .refine((m) => Object.keys(m).length <= 500, { message: "Terlalu banyak jawaban" }),
});

/** Snapshot webcam dikirim sbg data URL jpeg/png/webp, maks ~700KB base64. */
const SNAPSHOT_DATA_URL_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

export const proctorEventSchema = z
  .object({
    event_type: z.enum(["tab_blur", "fullscreen_exit", "paste", "disconnect", "webcam_snapshot"]),
    meta: z
      .record(z.string().max(50), z.union([z.string().max(200), z.number(), z.boolean()]))
      .refine((m) => Object.keys(m).length <= 20, { message: "Meta terlalu besar" })
      .optional(),
    snapshot: z
      .string()
      .max(700_000, "Snapshot terlalu besar")
      .regex(SNAPSHOT_DATA_URL_RE, "Format snapshot tidak valid")
      .optional(),
  })
  .refine((e) => e.event_type === "webcam_snapshot" || !e.snapshot, {
    message: "Snapshot hanya untuk event webcam_snapshot",
    path: ["snapshot"],
  });

// ── Panel HRD (TG4) ─────────────────────────────────────────────────────

export const psikotesSessionCreateSchema = z.object({
  instrument_ids: z
    .array(z.string().uuid("ID instrumen tidak valid"))
    .min(1, "Pilih minimal satu instrumen")
    .max(10, "Maksimal 10 instrumen")
    .refine((ids) => new Set(ids).size === ids.length, { message: "Instrumen duplikat" }),
  expires_days: z
    .number()
    .int("Masa berlaku harus bilangan bulat (hari)")
    .min(1, "Minimal 1 hari")
    .max(30, "Maksimal 30 hari")
    .default(3),
});

export const psikotesSummarySchema = z.object({
  recommendation: z.enum(["lolos", "hold", "tidak_lolos"]).nullable().default(null),
  notes: z.string().trim().max(2000, "Catatan maksimal 2000 karakter").nullable().default(null),
});

export const psikotesReviewSchema = z.object({
  review_notes: z
    .string()
    .trim()
    .min(1, "Kesimpulan review wajib diisi")
    .max(2000, "Kesimpulan maksimal 2000 karakter"),
});

export type PsikotesSessionCreateInput = z.infer<typeof psikotesSessionCreateSchema>;
export type PsikotesSummaryInput = z.infer<typeof psikotesSummarySchema>;
export type PsikotesReviewInput = z.infer<typeof psikotesReviewSchema>;

export type SessionStartInput = z.infer<typeof sessionStartSchema>;
export type SessionAnswersInput = z.infer<typeof sessionAnswersSchema>;
export type ProctorEventInput = z.infer<typeof proctorEventSchema>;

export type InstrumentConfigInput = z.infer<typeof instrumentConfigSchema>;
export type InstrumentUpdateInput = z.infer<typeof instrumentUpdateSchema>;
export type McqQuestionInput = z.infer<typeof mcqQuestionSchema>;
export type PapiQuestionInput = z.infer<typeof papiQuestionSchema>;

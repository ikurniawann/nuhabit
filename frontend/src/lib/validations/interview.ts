import { z } from "zod";

/** Validasi modul Interview AI (EPIC-003). */

const SNAPSHOT_DATA_URL_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

export const interviewProctorEventSchema = z
  .object({
    event_type: z.enum([
      "tab_blur",
      "fullscreen_exit",
      "paste",
      "disconnect",
      "webcam_snapshot",
      "face_not_detected",
      "multiple_faces",
      "camera_off",
    ]),
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

export const interviewSessionCreateSchema = z.object({
  expires_days: z.number().int().min(1).max(30).default(7),
  max_questions: z.number().int().min(3).max(15).default(8),
});

export const interviewStartSchema = z.object({
  // interview WAJIB on-cam — consent harus true utk mulai
  webcam_consent: z.literal(true, {
    message: "Interview mewajibkan kamera aktif — izinkan kamera untuk memulai",
  }),
});

export type InterviewProctorEventInput = z.infer<typeof interviewProctorEventSchema>;
export type InterviewSessionCreateInput = z.infer<typeof interviewSessionCreateSchema>;

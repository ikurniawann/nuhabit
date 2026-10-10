import { z } from "zod";
import { memberError, withMemberSession } from "@/lib/member-portal/route";
import {
  ACTIVITY_TYPES,
  ACTIVITY_VISIBILITIES,
  GEAR_KINDS,
  MAX_ACTIVITY_PHOTOS,
  MAX_COMMENT_LENGTH,
  MAX_PHOTO_BYTES,
} from "./athlete";
import { AthleteError } from "./athlete-views";

/** Handler API Train: sesi member wajib, AthleteError jadi respons dengan statusnya. */
export function athleteRoute<A extends unknown[]>(
  failMessage: string,
  handler: (customerId: string, ...args: A) => Promise<Response>,
) {
  return withMemberSession(
    failMessage,
    async (customerId: string, ...args: A) => {
      try {
        return await handler(customerId, ...args);
      } catch (error) {
        if (error instanceof AthleteError)
          return memberError(error.message, error.status);
        throw error;
      }
    },
  );
}

export type IdCtx<K extends string = "id"> = {
  params: Promise<Record<K, string>>;
};

/** Ambil parameter rute ber-UUID; selain UUID dianggap tidak ada (404). */
export async function uuidParam<K extends string>(
  ctx: IdCtx<K>,
  key: K,
): Promise<string> {
  const value = (await ctx.params)[key];
  if (!z.guid().safeParse(value).success)
    throw new AthleteError(404, "Data tidak ditemukan");
  return value;
}

/** Body JSON tervalidasi; gagal = 400 dengan pesan yang diberikan. */
export async function parseBody<S extends z.ZodTypeAny>(
  request: Request,
  schema: S,
  message: string,
): Promise<z.infer<S>> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw new AthleteError(400, message);
  return parsed.data;
}

const trackPoint = z.object({
  t: z.number().min(0),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  ele: z.number().optional(),
  segmentStart: z.boolean().optional(),
});
const photos = z
  .array(z.string().max(MAX_PHOTO_BYTES))
  .max(MAX_ACTIVITY_PHOTOS);

export const saveActivitySchema = z.object({
  type: z.enum(ACTIVITY_TYPES),
  title: z.string().max(120).default(""),
  description: z.string().max(2000).default(""),
  startedAt: z.iso.datetime({ offset: true }).nullable().default(null),
  points: z.array(trackPoint).max(50_000).default([]),
  /** Durasi manual untuk workout tanpa GPS. */
  manualElapsedSec: z
    .number()
    .int()
    .positive()
    .max(24 * 3600)
    .nullable()
    .default(null),
  gearId: z.guid().nullable().default(null),
  visibility: z.enum(ACTIVITY_VISIBILITIES).default("EVERYONE"),
  photos: photos.default([]),
});

export const updateActivitySchema = z.object({
  title: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  visibility: z.enum(ACTIVITY_VISIBILITIES).optional(),
  gearId: z.guid().nullable().optional(),
});

export const commentSchema = z.object({
  text: z.string().trim().min(1).max(MAX_COMMENT_LENGTH),
});

export const saveRouteSchema = z.object({
  activityId: z.guid(),
  name: z.string().trim().min(2).max(80),
});

export const gearSchema = z.object({
  name: z.string().trim().min(2).max(60),
  kind: z.enum(GEAR_KINDS),
  retired: z.boolean().default(false),
});

export const settingsSchema = z.object({
  units: z.enum(["METRIC", "IMPERIAL"]).optional(),
  bookingReminders: z.boolean().optional(),
  weeklyGoalKm: z.number().positive().max(1000).nullable().optional(),
  language: z.enum(["EN", "ID"]).optional(),
});

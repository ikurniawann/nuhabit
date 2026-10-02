import { z } from "zod";

/**
 * Skema validasi API Studio (EPIC-052). Dipisah dari route.ts karena file route
 * hanya boleh mengekspor handler.
 *
 * Penting (zod 4): `.partial()` TETAP menerapkan `.default()`, jadi skema PATCH
 * dibangun dari field tanpa default — kalau tidak, PATCH sebagian akan mereset
 * kolom lain ke nilai default.
 */

const optText = (max: number) => z.string().trim().max(max).nullable().optional();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Format jam HH:MM");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal YYYY-MM-DD");

// ── Coach ──────────────────────────────────────────────────────────────────
const coachFields = {
  employee_id: z.string().uuid().nullable().optional(),
  full_name: z.string().trim().min(1).max(120),
  display_name: optText(60),
  level: z.enum(["coach", "head_coach"]),
  phone: optText(30),
  email: z.union([z.string().trim().email().max(160), z.literal("").transform(() => null), z.null()]).optional(),
  photo_url: optText(500),
  bio: optText(2000),
  certifications: optText(2000),
  specialties: z.array(z.string().trim().min(1).max(40)).max(12),
  is_public: z.boolean(),
  is_active: z.boolean(),
  sort_order: z.number().int().min(0).max(999),
};
export const coachCreateSchema = z.object({
  ...coachFields,
  level: coachFields.level.default("coach"),
  specialties: coachFields.specialties.default([]),
  is_public: coachFields.is_public.default(true),
  is_active: coachFields.is_active.default(true),
  sort_order: coachFields.sort_order.default(0),
});
export const coachPatchSchema = z.object(coachFields).partial();

// ── Program ────────────────────────────────────────────────────────────────
const programFields = {
  code: z.string().trim().min(1).max(30).transform((v) => v.toUpperCase()),
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["class", "pt"]),
  description: optText(2000),
  duration_minutes: z.number().int().min(15).max(240),
  default_capacity: z.number().int().min(1).max(200),
  level_label: optText(40),
  is_active: z.boolean(),
  sort_order: z.number().int().min(0).max(999),
};
export const programCreateSchema = z.object({
  ...programFields,
  kind: programFields.kind.default("class"),
  duration_minutes: programFields.duration_minutes.default(60),
  default_capacity: programFields.default_capacity.default(12),
  is_active: programFields.is_active.default(true),
  sort_order: programFields.sort_order.default(0),
});
export const programPatchSchema = z.object(programFields).partial();

// ── Template mingguan ──────────────────────────────────────────────────────
const templateFields = {
  weekday: z.number().int().min(1).max(7),
  start_time: time,
  end_time: time,
  program_id: z.string().uuid(),
  coach_id: z.string().uuid().nullable().optional(),
  capacity: z.number().int().min(1).max(200),
  notes: optText(500),
  is_active: z.boolean(),
};
export const templateCreateSchema = z.object({
  ...templateFields,
  capacity: templateFields.capacity.optional(),
  is_active: templateFields.is_active.default(true),
});
export const templatePatchSchema = z.object(templateFields).partial();

// ── Sesi kelas ─────────────────────────────────────────────────────────────
const sessionFields = {
  session_date: date,
  start_time: time,
  end_time: time,
  program_id: z.string().uuid(),
  coach_id: z.string().uuid().nullable().optional(),
  capacity: z.number().int().min(1).max(200),
  status: z.enum(["scheduled", "cancelled", "completed"]),
  cancel_reason: optText(300),
  notes: optText(500),
};
export const sessionCreateSchema = z.object({
  ...sessionFields,
  capacity: sessionFields.capacity.optional(),
  status: sessionFields.status.default("scheduled"),
});
export const sessionPatchSchema = z.object(sessionFields).partial();

export const generateSchema = z.object({
  from: date,
  to: date,
  skip_holidays: z.boolean().default(true),
});

// ── Paket member (EPIC-053) ────────────────────────────────────────────────
const money = z.number().min(0).max(1_000_000_000);
const passProductFields = {
  code: z.string().trim().min(1).max(30).transform((v) => v.toUpperCase()),
  name: z.string().trim().min(1).max(120),
  category: z.enum(["class", "class_pt", "class_pt_facility", "pt"]),
  class_credits: z.number().int().min(0).max(500),
  pt_credits: z.number().int().min(0).max(500),
  facility_access: z.boolean(),
  validity_days: z.number().int().min(1).max(730),
  price: money,
  class_value: money,
  pt_value: money,
  facility_value: money,
  description: optText(2000),
  is_active: z.boolean(),
  is_public: z.boolean(),
  sort_order: z.number().int().min(0).max(999),
};
export const passProductCreateSchema = z.object({
  ...passProductFields,
  class_credits: passProductFields.class_credits.default(0),
  pt_credits: passProductFields.pt_credits.default(0),
  facility_access: passProductFields.facility_access.default(false),
  class_value: passProductFields.class_value.default(0),
  pt_value: passProductFields.pt_value.default(0),
  facility_value: passProductFields.facility_value.default(0),
  is_active: passProductFields.is_active.default(true),
  is_public: passProductFields.is_public.default(true),
  sort_order: passProductFields.sort_order.default(0),
});
export const passProductPatchSchema = z.object(passProductFields).partial();

// ── Member & penjualan pass ────────────────────────────────────────────────
export const memberCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(8).max(20),
  email: z.union([z.string().trim().email().max(160), z.literal("").transform(() => null), z.null()]).optional(),
  birth_date: date.nullable().optional(),
  gender: z.enum(["male", "female"]).nullable().optional(),
});

export const passSellSchema = z.object({
  customer_id: z.string().uuid(),
  product_id: z.string().uuid(),
  valid_from: date,
  payment_method: z.enum(["cash", "qris", "card", "transfer", "complimentary"]),
  payment_ref: optText(120),
  notes: optText(500),
  price_override: money.nullable().optional(),
});

export const passAdjustSchema = z.object({
  credit_type: z.enum(["class", "pt"]),
  qty: z.number().int().min(-100).max(100).refine((v) => v !== 0, "Jumlah tidak boleh 0"),
  note: z.string().trim().min(3).max(300),
});

export const passExtendSchema = z.object({
  days: z.number().int().min(1).max(180),
  reason: z.string().trim().min(3).max(300),
});

export const passCancelSchema = z.object({
  reason: z.string().trim().min(3).max(300),
});

// ── Booking (EPIC-054) ─────────────────────────────────────────────────────
export const bookingCreateSchema = z.object({
  session_id: z.string().uuid(),
  customer_id: z.string().uuid(),
  check_in: z.boolean().default(false),
  notes: optText(300),
});

export const bookingCancelSchema = z.object({
  reason: optText(300),
  waive: z.boolean().default(false),
});

export const checkInScanSchema = z.object({
  code: z.string().trim().min(3).max(40),
  session_id: z.string().uuid().nullable().optional(),
});

export const settingsPatchSchema = z
  .object({
    cancel_window_hours: z.number().int().min(0).max(72),
    booking_open_days: z.number().int().min(1).max(60),
    booking_close_minutes: z.number().int().min(0).max(240),
    checkin_open_minutes: z.number().int().min(0).max(240),
    waitlist_enabled: z.boolean(),
    max_active_bookings: z.number().int().min(0).max(50),
  })
  .partial();

export const memberBookSchema = z.object({ session_id: z.string().uuid() });

// ── Personal Training (EPIC-055) ───────────────────────────────────────────
export const availabilitySaveSchema = z.object({
  windows: z
    .array(z.object({ weekday: z.number().int().min(1).max(7), start_time: time, end_time: time }))
    .max(50),
  program_ids: z.array(z.string().uuid()).max(30),
});

export const timeOffCreateSchema = z.object({
  date_from: date,
  date_to: date,
  reason: optText(200),
});

export const ptBookingSchema = z.object({
  customer_id: z.string().uuid(),
  program_id: z.string().uuid(),
  coach_id: z.string().uuid(),
  date,
  start_time: time,
  notes: optText(300),
});

export const memberPtBookingSchema = ptBookingSchema.omit({ customer_id: true, notes: true });

// ── Komisi coach (EPIC-056) ────────────────────────────────────────────────
export const commissionSettingsSchema = z
  .object({
    class_pool_percent: z.number().min(0).max(100),
    pt_pool_percent: z.number().min(0).max(100),
    share_head_coach: z.number().min(0).max(100),
    share_coach: z.number().min(0).max(100),
  })
  .partial();

export const commissionPaySchema = z.object({
  method: z.enum(["cash", "transfer"]),
  ref: optText(120),
});

export const coachShareSchema = z.object({
  commission_share_percent: z.number().min(0).max(100).nullable(),
});

// ── Member App: beli paket online (EPIC-057) ───────────────────────────────
export const memberOrderSchema = z.object({ product_id: z.string().uuid() });

// ── News Hyrox (EPIC-057) ──────────────────────────────────────────────────
export const NEWS_CATEGORIES = ["news", "event", "tips", "promo"] as const;
const newsFields = {
  title: z.string().trim().min(3, "Judul minimal 3 karakter").max(160),
  category: z.enum(NEWS_CATEGORIES),
  summary: optText(300),
  body: optText(20000),
  image_url: optText(500),
  status: z.enum(["draft", "published"]),
  pinned: z.boolean(),
};
export const newsCreateSchema = z.object({
  ...newsFields,
  category: newsFields.category.default("news"),
  status: newsFields.status.default("draft"),
  pinned: newsFields.pinned.default(false),
});
export const newsPatchSchema = z.object(newsFields).partial();

// ── Otomasi & Pengingat (EPIC-058) ─────────────────────────────────────────
export const jobSettingsSchema = z
  .object({
    auto_close_enabled: z.boolean(),
    auto_close_hour: z.number().int().min(18).max(23),
    reminders_enabled: z.boolean(),
    reminder_hour: z.number().int().min(8).max(20),
    pass_low_threshold: z.number().int().min(1).max(5),
    pass_expiring_days: z.number().int().min(1).max(14),
  })
  .partial();
export const jobRunSchema = z.object({ job: z.enum(["daily_close", "reminders"]) });
export const memberPrefsSchema = z
  .object({ wa_reminders: z.boolean(), leaderboard_opt_in: z.boolean() })
  .partial()
  .refine((v) => v.wa_reminders !== undefined || v.leaderboard_opt_in !== undefined, "Tidak ada perubahan");

// ── Program Loyalitas (EPIC-066) ───────────────────────────────────────────
export const loyaltyRulePatchSchema = z
  .object({
    xp_value: z.number().min(0).max(100000),
    amount_step: z.number().min(1).max(100000000),
    is_active: z.boolean(),
    metadata: z.record(z.string(), z.unknown()),
  })
  .partial();
export const loyaltyTierPatchSchema = z
  .object({
    name: z.string().trim().min(2).max(40),
    min_lifetime_xp: z.number().int().min(0).max(10000000),
    discount_percent: z.number().min(0).max(100),
    early_booking_days: z.number().int().min(0).max(14),
    cancel_window_hours: z.number().int().min(0).max(72).nullable(),
    waitlist_priority: z.boolean(),
  })
  .partial();
export const memberStatusSchema = z.object({
  status: z.enum(["active", "suspended", "banned"]),
  reason: z.string().trim().max(300).nullable().optional(),
});

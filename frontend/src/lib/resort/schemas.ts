import { z } from "zod";
import { FOLIO_CHARGE_TYPES, RESERVATION_SOURCES } from "./reservation";

/** Body API modul Resort (route memvalidasi lewat validateBody). */

export const roomTypeCreateSchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional().nullable(),
  zone: z.string().trim().max(60).optional().nullable(),
  capacity_adults: z.number().int().min(1).max(50).default(2),
  capacity_children: z.number().int().min(0).max(50).default(0),
  extra_bed_capacity: z.number().int().min(0).max(10).default(0),
  rate_weekday: z.number().min(0).default(0),
  rate_weekend: z.number().min(0).default(0),
  extra_bed_rate: z.number().min(0).default(0),
  amenities: z.array(z.string().trim().max(60)).max(30).default([]),
  sort_order: z.number().int().min(0).max(999).default(0),
});
export type RoomTypeCreateInput = z.infer<typeof roomTypeCreateSchema>;

export const roomTypePatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  zone: z.string().trim().max(60).nullable().optional(),
  capacity_adults: z.number().int().min(1).max(50).optional(),
  capacity_children: z.number().int().min(0).max(50).optional(),
  extra_bed_capacity: z.number().int().min(0).max(10).optional(),
  rate_weekday: z.number().min(0).optional(),
  rate_weekend: z.number().min(0).optional(),
  extra_bed_rate: z.number().min(0).optional(),
  amenities: z.array(z.string().trim().max(60)).max(30).optional(),
  sort_order: z.number().int().min(0).max(999).optional(),
  is_active: z.boolean().optional(),
});
export type RoomTypePatch = z.infer<typeof roomTypePatchSchema>;

export const roomCreateSchema = z.object({
  room_type_id: z.string().uuid(),
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(120),
  zone: z.string().trim().max(60).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});
export type RoomCreateInput = z.infer<typeof roomCreateSchema>;

export const roomPatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  zone: z.string().trim().max(60).nullable().optional(),
  status: z.enum(["siap", "kotor", "perbaikan", "ditutup"]).optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  is_active: z.boolean().optional(),
  room_type_id: z.string().uuid().optional(),
});
export type RoomPatch = z.infer<typeof roomPatchSchema>;

export const reservationCreateSchema = z.object({
  guest_name: z.string().trim().min(2).max(150),
  guest_phone: z.string().trim().min(6).max(30),
  guest_email: z.string().trim().email().max(150).optional().nullable(),
  check_in: z.string(),
  check_out: z.string(),
  adults: z.number().int().min(1).max(50).default(2),
  children: z.number().int().min(0).max(50).default(0),
  source: z.enum(RESERVATION_SOURCES).default("walk-in"),
  status: z.enum(["menunggu-bayar", "terkonfirmasi"]).default("menunggu-bayar"),
  discount_amount: z.number().min(0).default(0),
  notes: z.string().trim().max(1000).optional().nullable(),
  special_request: z.string().trim().max(1000).optional().nullable(),
  rooms: z.array(z.object({
    room_type_id: z.string().uuid(),
    qty: z.number().int().min(1).max(20).default(1),
    extra_bed: z.number().int().min(0).max(10).default(0),
    guest_name: z.string().trim().max(150).optional().nullable(),
    room_id: z.string().uuid().optional().nullable(),
  })).min(1).max(20),
});
export type ReservationCreateInput = z.infer<typeof reservationCreateSchema>;

export const reservationPatchSchema = z.object({
  guest_name: z.string().trim().min(2).max(150).optional(),
  guest_phone: z.string().trim().min(6).max(30).optional(),
  guest_email: z.string().trim().email().max(150).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  special_request: z.string().trim().max(1000).nullable().optional(),
});
export type ReservationPatch = z.infer<typeof reservationPatchSchema>;

export const STATUS_ACTIONS = ["konfirmasi", "check-in", "check-out", "batal", "no-show"] as const;

export const statusChangeSchema = z.object({
  action: z.enum(STATUS_ACTIONS),
  assignments: z.array(z.object({ reservation_room_id: z.string().uuid(), room_id: z.string().uuid() })).max(20).optional(),
  reason: z.string().trim().max(500).optional().nullable(),
  force: z.boolean().optional(),
});
export type StatusChangeInput = z.infer<typeof statusChangeSchema>;

export const folioChargeSchema = z.object({
  charge_type: z.enum(FOLIO_CHARGE_TYPES),
  description: z.string().trim().min(2).max(200),
  amount: z.number().positive().max(1_000_000_000),
  payment_method: z.string().trim().max(30).optional().nullable(),
});
export type FolioChargeInput = z.infer<typeof folioChargeSchema>;

import { z } from "zod";
import { getPool } from "@/lib/db";
import { engagementRoute, fail, ok } from "@/lib/crm/engagement/admin-route";
import { cancelEvent } from "@/lib/crm/engagement/server";

const eventSchema = z
  .object({
    id: z.string().uuid().optional(),
    title: z.string().trim().min(3).max(120),
    description: z.string().max(2_000).default(""),
    host_name: z.string().trim().max(120).optional().nullable(),
    location: z.string().trim().max(160).optional().nullable(),
    starts_at: z.string().datetime({ offset: true }),
    ends_at: z.string().datetime({ offset: true }),
    capacity: z.number().int().min(1).max(10_000),
    price_idr: z.number().min(0).max(100_000_000).default(0),
    booking_closes_hours: z.number().int().min(0).max(720).default(0),
    cancel_deadline_hours: z.number().int().min(0).max(720).default(2),
    status: z.enum(["draft", "published"]),
  })
  .refine((e) => new Date(e.ends_at) > new Date(e.starts_at), { message: "Selesai harus setelah mulai" });

/** GET — semua event, terdekat dulu, dengan hitungan peserta. */
export const GET = engagementRoute("Gagal memuat event", async () => {
  const { rows } = await getPool().query(
    `SELECT e.*, e.price_idr::float AS price_idr,
            count(b.*) FILTER (WHERE b.status IN ('confirmed', 'attended'))::int AS confirmed_count,
            count(b.*) FILTER (WHERE b.status = 'waitlist')::int AS waitlist_count,
            count(b.*) FILTER (WHERE b.status = 'attended')::int AS attended_count
       FROM crm.events e LEFT JOIN crm.event_bookings b ON b.event_id = e.id
      GROUP BY e.id
      ORDER BY (e.ends_at < now()), e.starts_at`
  );
  return ok(rows);
});

/** POST — buat atau ubah event. Event yang dibatalkan tidak bisa diubah lagi. */
export const POST = engagementRoute("Gagal menyimpan event", async (request: Request) => {
  const e = eventSchema.parse(await request.json());
  const params = [
    e.title, e.description, e.host_name ?? null, e.location ?? null, e.starts_at, e.ends_at,
    e.capacity, e.price_idr, e.booking_closes_hours, e.cancel_deadline_hours, e.status,
  ];
  const { rows } = e.id
    ? await getPool().query(
        `UPDATE crm.events SET title=$1, description=$2, host_name=$3, location=$4, starts_at=$5, ends_at=$6,
                capacity=$7, price_idr=$8, booking_closes_hours=$9, cancel_deadline_hours=$10, status=$11,
                updated_at=now()
          WHERE id=$12 AND status <> 'cancelled' RETURNING id`,
        [...params, e.id]
      )
    : await getPool().query(
        `INSERT INTO crm.events (title, description, host_name, location, starts_at, ends_at, capacity,
                                 price_idr, booking_closes_hours, cancel_deadline_hours, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        params
      );
  if (!rows[0]) return fail("Event tidak ditemukan atau sudah dibatalkan", 404);
  return ok(rows[0]);
});

/** DELETE ?id= — batalkan event; setiap member yang terdaftar dikabari. */
export const DELETE = engagementRoute("Gagal membatalkan event", async (request: Request) => {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!z.string().uuid().safeParse(id).success) return fail("ID tidak valid");
  return ok({ notified: await cancelEvent(id) });
});

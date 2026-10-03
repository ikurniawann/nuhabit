import { z } from "zod";
import { getPool, withTransaction } from "@/lib/db";
import { IAM } from "@/lib/iam/prefixes";
import { scanGymQr } from "@/lib/gym/booking-server";
import { ok, schedulingRoute } from "@/lib/gym/scheduling-route";

/** GET — 100 scan gym terakhir + ringkasan hari ini (WIB). */
export const GET = schedulingRoute(IAM.gymCheckin, "Gagal memuat log check-in", async () => {
  const pool = getPool();
  const [{ rows }, { rows: today }] = await Promise.all([
    pool.query(
      `SELECT l.id, l.decision, l.reason, l.entry_kind, l.credit_delta, l.source, l.created_at,
              c.name AS member_name, c.phone AS member_phone, t.name AS class_type_name, s.starts_at,
              u.full_name AS staff_name
         FROM gym.access_logs l
         LEFT JOIN pos.pos_customers c ON c.id = l.customer_id
         LEFT JOIN gym.bookings b ON b.id = l.booking_id
         LEFT JOIN gym.class_sessions s ON s.id = b.session_id
         LEFT JOIN gym.class_types t ON t.id = s.class_type_id
         LEFT JOIN configuration.users u ON u.id = l.scanned_by
        ORDER BY l.created_at DESC LIMIT 100`
    ),
    pool.query(
      `SELECT count(*) FILTER (WHERE decision = 'allowed' AND entry_kind = 'booking')::int AS checked_in,
              count(*) FILTER (WHERE decision = 'denied')::int AS denied,
              COALESCE(-sum(credit_delta), 0)::int AS credits
         FROM gym.access_logs
        WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta'`
    ),
  ]);
  return ok({ log: rows, today: today[0] });
});

const scanSchema = z.object({ token: z.string().trim().min(8).max(120), branch_id: z.string().uuid().nullable().optional() });

/** POST {token} — scan QR member di gate/front desk: check-in kelas + potong kredit, atau alasan ditolak. */
export const POST = schedulingRoute(IAM.gymCheckin, "Gagal memeriksa QR", async (userId, request: Request) => {
  const input = scanSchema.parse(await request.json());
  const result = await withTransaction((client) =>
    scanGymQr(client, { token: input.token, branchId: input.branch_id ?? null, scannedBy: userId })
  );
  return ok(result);
});

import type { Pool, PoolClient } from "pg";
import { getPool } from "@/lib/db";
import { sendWhatsAppOtp } from "@/lib/whatsapp";
import {
  generateOtpCode,
  hashSecret,
  OTP_MAX_ATTEMPTS,
  OTP_RATE_LIMIT_COUNT,
  OTP_RATE_LIMIT_WINDOW_MS,
  OTP_TTL_MS,
  otpMessage,
} from "./otp";

/**
 * Penyimpanan OTP portal member (crm.member_portal_otp): kirim kode dengan
 * rate limit per nomor, lalu periksa + konsumsi kode. Dipakai login (otp,
 * verify) dan pendaftaran mandiri (register) supaya aturannya satu.
 */

type Db = Pool | PoolClient;

export type OtpFailure = { ok: false; error: string; status: number };

/** Nomor (digit 62xxx) yang cocok dengan pos_customers aktif, atau null. */
export async function findMemberByPhone(
  db: Db,
  phone: string
): Promise<{ id: string; name: string | null } | null> {
  // Nomor di DB bisa tersimpan 08xx / 62xx; cocokkan digit.
  const { rows } = await db.query(
    `SELECT id, name FROM pos.pos_customers
     WHERE is_active IS NOT FALSE
       AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g')
           IN ($1, '0' || substring($1 from 3))
     LIMIT 1`,
    [phone]
  );
  return rows[0] ?? null;
}

/** Simpan + kirim kode OTP baru. Rate limit 3 permintaan / 10 menit / nomor. */
export async function issueOtp(phone: string): Promise<{ ok: true; waDelivered: boolean } | OtpFailure> {
  const pool = getPool();
  const { rows: recent } = await pool.query(
    `SELECT count(*)::int AS n FROM crm.member_portal_otp
     WHERE phone = $1 AND created_at > now() - ($2 || ' milliseconds')::interval`,
    [phone, OTP_RATE_LIMIT_WINDOW_MS]
  );
  if (recent[0].n >= OTP_RATE_LIMIT_COUNT) {
    return { ok: false, error: "Terlalu banyak permintaan. Coba lagi dalam 10 menit", status: 429 };
  }

  const code = generateOtpCode();
  await pool.query(
    `INSERT INTO crm.member_portal_otp (phone, code_hash, expires_at)
     VALUES ($1, $2, now() + ($3 || ' milliseconds')::interval)`,
    [phone, hashSecret(code), OTP_TTL_MS]
  );

  const sent = await sendWhatsAppOtp({ target: phone, code, fallbackText: otpMessage(code) });
  if (!sent.success) {
    // Kode hanya boleh muncul di log NON-produksi (jalan keluar saat
    // FONNTE_API_KEY belum diisi). Kode OTP di log produksi = siapa pun yang
    // bisa membaca log bisa masuk sebagai member mana pun.
    if (process.env.NODE_ENV === "production") {
      console.error(`[member-portal] OTP WA gagal terkirim ke ${phone} (${sent.reason})`);
    } else {
      console.warn(
        `[member-portal] OTP WA gagal terkirim ke ${phone} (${sent.reason}); kode utk debug dev: ${code}`
      );
    }
  }
  return { ok: true, waDelivered: sent.success };
}

/**
 * Periksa kode terbaru nomor ini lalu tandai terpakai. Kode salah menambah
 * hitungan percobaan; setelah 5 kali kode itu mati.
 */
export async function consumeOtp(db: Db, phone: string, code: string): Promise<{ ok: true } | OtpFailure> {
  const { rows } = await db.query(
    `SELECT id, code_hash, attempts, expires_at, consumed_at
       FROM crm.member_portal_otp
      WHERE phone = $1
      ORDER BY created_at DESC LIMIT 1`,
    [phone]
  );
  const otp = rows[0];
  if (!otp || otp.consumed_at || new Date(otp.expires_at) < new Date()) {
    return { ok: false, error: "Kode kedaluwarsa. Minta kode baru", status: 400 };
  }
  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    return { ok: false, error: "Terlalu banyak percobaan. Minta kode baru", status: 429 };
  }
  if (otp.code_hash !== hashSecret(code)) {
    await db.query(`UPDATE crm.member_portal_otp SET attempts = attempts + 1 WHERE id = $1`, [otp.id]);
    return { ok: false, error: "Kode salah", status: 400 };
  }
  await db.query(`UPDATE crm.member_portal_otp SET consumed_at = now() WHERE id = $1`, [otp.id]);
  return { ok: true };
}

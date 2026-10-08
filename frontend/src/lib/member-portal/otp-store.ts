import type { Pool, PoolClient } from "pg";
import { getPool } from "@/lib/db";
import { checkRateLimit, type RateLimitRule } from "@/lib/public/rate-limit";
import { clientIp } from "@/lib/security/client-ip";
import { safeEqual } from "@/lib/security/compare";
import { sendWhatsAppOtp } from "@/lib/whatsapp";
import {
  generateOtpCode,
  hashSecret,
  OTP_MAX_ATTEMPTS,
  OTP_RATE_LIMIT_COUNT,
  OTP_RATE_LIMIT_WINDOW_MS,
  OTP_TTL_MS,
  otpMessage,
  normalizePhoneDigits,
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

export type MemberLoginCandidate = {
  id: string;
  name: string | null;
  password_hash: string | null;
};

/**
 * Cari akun untuk login berpassword: nomor WhatsApp (digit 08xx/62xx) ATAU
 * email yang tersimpan di pos_customers.
 *
 * Nama sengaja TIDAK ikut dicari walau halaman login menyebutnya: nama tidak
 * unik, jadi dua member bernama sama akan ambigu dan itu jalan masuk akun orang
 * lain. Nomor dinormalkan (08xx ↔ 62xx) supaya kasir boleh menyimpan format
 * mana pun.
 */
export async function findMemberLoginCandidate(
  db: Db,
  username: string
): Promise<MemberLoginCandidate | null> {
  const digits = normalizePhoneDigits(username);
  const { rows } = await db.query(
    `SELECT id, name, password_hash
       FROM pos.pos_customers
      WHERE is_active IS NOT FALSE
        AND (
          ($1::text IS NOT NULL AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g')
             IN ($1, '0' || substring($1 from 3)))
          OR lower(COALESCE(email, '')) = lower($2)
        )
      ORDER BY (lower(COALESCE(email, '')) = lower($2)) DESC
      LIMIT 1`,
    [digits, username]
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
 * Periksa kode terbaru nomor ini lalu tandai terpakai. Setiap percobaan
 * menambah hitungan SECARA ATOMIK sebelum kode dibandingkan, jadi tebakan
 * paralel tidak bisa melewati batas 5 percobaan per kode.
 */
export async function consumeOtp(db: Db, phone: string, code: string): Promise<{ ok: true } | OtpFailure> {
  const expired: OtpFailure = { ok: false, error: "Kode kedaluwarsa. Minta kode baru", status: 400 };
  const { rows } = await db.query(
    `SELECT id, code_hash, expires_at, consumed_at
       FROM crm.member_portal_otp
      WHERE phone = $1
      ORDER BY created_at DESC LIMIT 1`,
    [phone]
  );
  const otp = rows[0];
  if (!otp || otp.consumed_at || new Date(otp.expires_at) < new Date()) return expired;

  const { rows: claimed } = await db.query(
    `UPDATE crm.member_portal_otp SET attempts = attempts + 1
      WHERE id = $1 AND attempts < $2 AND consumed_at IS NULL
      RETURNING id`,
    [otp.id, OTP_MAX_ATTEMPTS]
  );
  if (claimed.length === 0) {
    return { ok: false, error: "Terlalu banyak percobaan. Minta kode baru", status: 429 };
  }
  if (!safeEqual(otp.code_hash, hashSecret(code))) {
    return { ok: false, error: "Kode salah", status: 400 };
  }
  const { rows: consumed } = await db.query(
    `UPDATE crm.member_portal_otp SET consumed_at = now()
      WHERE id = $1 AND consumed_at IS NULL
      RETURNING id`,
    [otp.id]
  );
  return consumed.length > 0 ? { ok: true } : expired;
}

/**
 * Rem per-IP (in-memory, sliding window) di atas batas per-nomor dan
 * per-kode: menahan satu klien yang menebar permintaan ke banyak nomor.
 * Longgar karena banyak member bisa berbagi satu IP Wi-Fi kafe.
 */
export const MEMBER_IP_LIMITS = {
  otp: { limit: 30, windowMs: 10 * 60_000 },
  verify: { limit: 60, windowMs: 10 * 60_000 },
  login: { limit: 30, windowMs: 10 * 60_000 },
} satisfies Record<string, RateLimitRule>;

/**
 * Batas per-AKUN untuk login berpassword: 10 percobaan / 15 menit.
 *
 * Ini penjaga utamanya, bukan batas per-IP — IP kafe dipakai bersama banyak
 * member, dan penyerang bisa berpindah IP. Kunci = username yang diketik
 * (dinormalkan huruf kecil + spasi dipangkas).
 */
export const MEMBER_LOGIN_LIMITS = {
  account: { limit: 10, windowMs: 15 * 60_000 },
} satisfies Record<string, RateLimitRule>;

export function memberLoginAllowed(username: string): boolean {
  return checkRateLimit(
    `member-login:${username.trim().toLowerCase()}`,
    MEMBER_LOGIN_LIMITS.account
  );
}

export function memberIpAllowed(kind: keyof typeof MEMBER_IP_LIMITS, request: Request): boolean {
  return checkRateLimit(`member-${kind}:${clientIp(request)}`, MEMBER_IP_LIMITS[kind]);
}

export const TOO_MANY_FROM_IP: OtpFailure = {
  ok: false,
  error: "Terlalu banyak permintaan dari jaringan ini. Coba lagi beberapa menit lagi",
  status: 429,
};

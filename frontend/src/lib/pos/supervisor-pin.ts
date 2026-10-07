import bcrypt from "bcryptjs";

/**
 * PIN supervisor POS (void & merge order).
 *
 * Sejak UI kelola PIN (2026-08-16), `users.pos_pin` disimpan sebagai hash
 * bcrypt. Nilai plaintext lama yang diisi manual ke DB tetap diterima
 * sampai di-reset lewat UI — void tidak boleh macet selama transisi.
 */

export const POS_PIN_PATTERN = /^\d{4,6}$/;

export function isValidPosPin(pin: string): boolean {
  return POS_PIN_PATTERN.test(pin);
}

export async function hashPosPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 10);
}

export async function verifyPosPin(
  pin: string,
  stored: string | null | undefined
): Promise<boolean> {
  if (!stored) return false;
  if (stored.startsWith("$2")) return bcrypt.compare(pin, stored);
  // Legacy: plaintext yang diisi manual sebelum ada UI.
  return stored === pin;
}

export interface SupervisorPinRow {
  id: string;
  full_name: string | null;
  pos_pin: string | null;
}

/** Cari supervisor yang PIN-nya cocok; null bila tidak ada. */
export async function findSupervisorByPin<T extends SupervisorPinRow>(
  supervisors: T[],
  pin: string
): Promise<T | null> {
  for (const supervisor of supervisors) {
    if (await verifyPosPin(pin, supervisor.pos_pin)) return supervisor;
  }
  return null;
}

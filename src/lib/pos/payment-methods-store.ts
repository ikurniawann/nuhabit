import { query, queryOne } from "@/lib/db";
import { isPaymentMethodEnabled } from "@/lib/crm/loyalty-features";
import { getLoyaltyFeatures } from "@/lib/crm/loyalty-features-server";
import {
  DEFAULT_POS_PAYMENT_METHODS,
  PROTECTED_PAYMENT_METHOD_CODES,
  canRenamePaymentMethodCode,
  isManualPaymentHandler,
  isPosPaymentHandler,
  isPosPaymentMethodCode,
  isValidPaymentMethodCode,
  slugifyPaymentMethodCode,
  type ManualPaymentHandler,
  type PosPaymentHandler,
  type PosPaymentMethod,
} from "@/lib/pos/payment-methods";

type PaymentMethodRow = {
  id: string;
  code: string;
  name: string;
  description: string;
  icon: string;
  handler: string;
  is_active: boolean;
  sort_order: number;
  requires_cash_input: boolean;
};

function mapRow(row: PaymentMethodRow): PosPaymentMethod | null {
  if (!isValidPaymentMethodCode(row.code)) return null;
  if (!isPosPaymentHandler(row.handler)) return null;
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description || "",
    icon: row.icon || "banknote",
    handler: row.handler as PosPaymentHandler,
    is_active: Boolean(row.is_active),
    sort_order: Number(row.sort_order) || 100,
    requires_cash_input: Boolean(row.requires_cash_input),
  };
}

export async function listPosPaymentMethods(opts?: {
  activeOnly?: boolean;
}): Promise<PosPaymentMethod[]> {
  try {
    const rows = await query<PaymentMethodRow>(
      `SELECT id, code, name, description, icon, handler,
              is_active, sort_order, requires_cash_input
       FROM pos.payment_methods
       WHERE ($1::boolean IS NOT TRUE OR is_active = true)
       ORDER BY sort_order ASC, name ASC`,
      [opts?.activeOnly === true]
    );
    const methods = rows
      .map(mapRow)
      .filter((row): row is PosPaymentMethod => row !== null);
    if (!opts?.activeOnly) return methods;
    // Daftar aktif = yang ditawarkan kasir. ARK Coin ikut disembunyikan bila
    // fiturnya dimatikan di CRM → Pengaturan; daftar admin tetap lengkap.
    const features = await getLoyaltyFeatures();
    return methods.filter((method) => isPaymentMethodEnabled(method.code, features));
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "42P01") {
      const list = DEFAULT_POS_PAYMENT_METHODS;
      return opts?.activeOnly ? list.filter((m) => m.is_active) : list;
    }
    throw err;
  }
}

export async function updatePosPaymentMethod(
  code: string,
  patch: {
    name?: string;
    description?: string;
    is_active?: boolean;
    sort_order?: number;
    new_code?: string;
  }
): Promise<PosPaymentMethod | null> {
  const normalized = slugifyPaymentMethodCode(code);
  if (!normalized || !isValidPaymentMethodCode(normalized)) return null;

  const sets: string[] = ["updated_at = now()"];
  const values: unknown[] = [];
  const add = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };
  if (patch.name !== undefined) add("name", patch.name);
  if (patch.description !== undefined) add("description", patch.description);
  if (patch.is_active !== undefined) add("is_active", patch.is_active);
  if (patch.sort_order !== undefined) add("sort_order", patch.sort_order);
  if (patch.new_code !== undefined) {
    const nextCode = slugifyPaymentMethodCode(patch.new_code);
    if (!nextCode || nextCode.length < 2 || !isValidPaymentMethodCode(nextCode)) {
      throw new Error("Kode metode tidak valid");
    }
    if (!canRenamePaymentMethodCode(normalized)) {
      throw new Error("Kode metode bawaan tidak bisa diubah");
    }
    if (isPosPaymentMethodCode(nextCode)) {
      throw new Error("Kode itu dipakai metode bawaan");
    }
    if (nextCode !== normalized) {
      const taken = await queryOne<{ id: string }>(
        `SELECT id FROM pos.payment_methods WHERE code = $1`,
        [nextCode]
      );
      if (taken) {
        throw new Error("Kode metode sudah dipakai");
      }
      add("code", nextCode);
    }
  }

  if (sets.length === 1) {
    return queryOne<PaymentMethodRow>(
      `SELECT id, code, name, description, icon, handler,
              is_active, sort_order, requires_cash_input
       FROM pos.payment_methods WHERE code = $1`,
      [normalized]
    ).then((row) => (row ? mapRow(row) : null));
  }

  values.push(normalized);
  const row = await queryOne<PaymentMethodRow>(
    `UPDATE pos.payment_methods
     SET ${sets.join(", ")}
     WHERE code = $${values.length}
     RETURNING id, code, name, description, icon, handler,
               is_active, sort_order, requires_cash_input`,
    values
  );
  return row ? mapRow(row) : null;
}

export async function createPosPaymentMethod(input: {
  name: string;
  code?: string;
  description?: string;
  handler: ManualPaymentHandler;
}): Promise<PosPaymentMethod> {
  if (!isManualPaymentHandler(input.handler)) {
    throw new Error("Metode baru hanya boleh Tunai atau Kartu — bukan QRIS/Xendit");
  }
  const name = input.name.trim();
  if (name.length < 2) {
    throw new Error("Nama metode minimal 2 karakter");
  }
  const base = slugifyPaymentMethodCode(input.code || name);
  if (base.length < 2 || !isValidPaymentMethodCode(base)) {
    throw new Error("Kode metode tidak valid");
  }

  const existing = await query<{ code: string }>(
    `SELECT code FROM pos.payment_methods WHERE code = $1 OR code LIKE $2`,
    [base, `${base}_%`]
  );
  const taken = new Set(existing.map((row) => row.code));
  if (isPosPaymentMethodCode(base) || taken.has(base)) {
    let code = base;
    for (let i = 2; taken.has(code) || isPosPaymentMethodCode(code); i += 1) {
      code = `${base}_${i}`.slice(0, 40);
    }
    return insertPaymentMethod({
      code,
      name,
      description: (input.description || "").trim(),
      handler: input.handler,
    });
  }

  return insertPaymentMethod({
    code: base,
    name,
    description: (input.description || "").trim(),
    handler: input.handler,
  });
}

async function insertPaymentMethod(input: {
  code: string;
  name: string;
  description: string;
  handler: ManualPaymentHandler;
}): Promise<PosPaymentMethod> {
  const maxRow = await queryOne<{ max: number | string | null }>(
    `SELECT MAX(sort_order) AS max FROM pos.payment_methods`
  );
  const sortOrder = (Number(maxRow?.max) || 0) + 10;
  const requiresCash = input.handler === "cash";
  const icon = input.handler === "credit" ? "credit-card" : "banknote";

  const row = await queryOne<PaymentMethodRow>(
    `INSERT INTO pos.payment_methods (
       code, name, description, icon, handler, is_active, sort_order, requires_cash_input
     ) VALUES ($1, $2, $3, $4, $5, true, $6, $7)
     RETURNING id, code, name, description, icon, handler,
               is_active, sort_order, requires_cash_input`,
    [
      input.code,
      input.name,
      input.description,
      icon,
      input.handler,
      sortOrder,
      requiresCash,
    ]
  );
  const mapped = row ? mapRow(row) : null;
  if (!mapped) {
    throw new Error("Gagal menyimpan metode bayar");
  }
  return mapped;
}

/** Hapus metode kustom. Metode bawaan ber-alur khusus dilindungi. */
export async function deletePosPaymentMethod(code: string): Promise<boolean> {
  if (!isValidPaymentMethodCode(code)) return false;
  if (PROTECTED_PAYMENT_METHOD_CODES.has(code)) {
    throw new Error("Metode bawaan tidak bisa dihapus — nonaktifkan saja");
  }
  const row = await queryOne<{ code: string }>(
    `DELETE FROM pos.payment_methods WHERE code = $1 RETURNING code`,
    [code]
  );
  return Boolean(row);
}

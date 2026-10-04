/**
 * Produk privilege member (EPIC-011 Fase C, keputusan owner #4):
 * produk ber-`min_xp` hanya boleh dibeli member dgn lifetime XP cukup —
 * bayar normal, XP TIDAK dipotong (pengganti alur redeem lama).
 * Syarat tier tidak dibuat terpisah: tier = fungsi lifetime XP, jadi
 * min_xp saja sudah ekuivalen.
 */

interface PrivilegeClient {
  from(table: string): {
    select(sel: string): {
      in(
        col: string,
        values: string[]
      ): PromiseLike<{ data: unknown; error: unknown }>;
      eq(
        col: string,
        value: string
      ): {
        maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>;
      };
    };
  };
}

export interface PrivilegeCheckResult {
  allowed: boolean;
  /** Pesan siap-tampil utk kasir/portal bila ditolak */
  message?: string;
}

export async function checkProductPrivileges(
  db: PrivilegeClient,
  productIds: string[],
  customerId: string | null | undefined
): Promise<PrivilegeCheckResult> {
  const ids = [...new Set(productIds.filter(Boolean))];
  if (ids.length === 0) return { allowed: true };

  const { data: products } = await db
    .from("pos_products")
    .select("id, name, min_xp")
    .in("id", ids);
  const privileged = ((products ?? []) as {
    id: string;
    name: string;
    min_xp: number | null;
  }[]).filter((product) => product.min_xp !== null && Number(product.min_xp) > 0);
  if (privileged.length === 0) return { allowed: true };

  const names = privileged.map((product) => product.name).join(", ");
  if (!customerId) {
    return {
      allowed: false,
      message: `Produk khusus member (${names}) — pilih member terlebih dulu`,
    };
  }

  const { data: customer } = await db
    .from("pos_customers")
    .select("id, total_xp")
    .eq("id", customerId)
    .maybeSingle();
  const totalXp = Number((customer as { total_xp?: unknown } | null)?.total_xp) || 0;

  const blocked = privileged.filter(
    (product) => totalXp < Number(product.min_xp)
  );
  if (blocked.length === 0) return { allowed: true };

  const detail = blocked
    .map((product) => `${product.name} (butuh ${Number(product.min_xp)} XP)`)
    .join(", ");
  return {
    allowed: false,
    message: `XP member belum cukup untuk: ${detail}. XP member saat ini: ${totalXp}.`,
  };
}

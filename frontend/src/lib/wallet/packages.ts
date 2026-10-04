/** Paket top-up dompet (pure): skema input, ketersediaan, bonus. */
import { z } from "zod";
import { formatRupiah } from "@/lib/format";

export interface TopupPackage {
  id: string;
  name: string;
  description: string;
  price_idr: number;
  credit_idr: number;
  validity_days: number | null;
  is_active: boolean;
  available_online: boolean;
  branch_ids: string[] | null;
  sort: number;
}

export const packageInputSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(300).default(""),
    price_idr: z.number().int().min(1_000).max(100_000_000),
    credit_idr: z.number().int().min(1_000).max(200_000_000),
    validity_days: z.number().int().min(1).max(3_650).nullable().default(null),
    is_active: z.boolean().default(true),
    available_online: z.boolean().default(true),
    branch_ids: z.array(z.string().uuid()).max(100).nullable().default(null),
    sort: z.number().int().min(0).max(10_000).default(0),
  })
  .refine((p) => p.credit_idr >= p.price_idr, {
    message: "Saldo yang diterima tidak boleh lebih kecil dari harga",
    path: ["credit_idr"],
  });

export type PackageInput = z.infer<typeof packageInputSchema>;

export const packageBonus = (pkg: Pick<TopupPackage, "price_idr" | "credit_idr">) =>
  Math.max(0, Number(pkg.credit_idr) - Number(pkg.price_idr));

/** Paket boleh dijual di cabang ini? Tanpa daftar cabang = semua cabang. */
export function packageAvailableAt(
  pkg: Pick<TopupPackage, "is_active" | "branch_ids">,
  branchId: string | null
): boolean {
  if (!pkg.is_active) return false;
  if (!pkg.branch_ids || pkg.branch_ids.length === 0) return true;
  return branchId != null && pkg.branch_ids.includes(branchId);
}

/** Nominal top-up bebas member harus di antara minimum dan maksimum. */
export function checkFreeAmount(amount: number, min: number, max: number): string | null {
  if (!Number.isInteger(amount) || amount <= 0) return "Nominal top-up tidak valid";
  if (amount < min) return `Minimal top-up ${formatRupiah(min)}`;
  if (max > 0 && amount > max) return `Maksimal top-up ${formatRupiah(max)}`;
  return null;
}

import { queryOne } from "@/lib/db";
import { buildContractNumber, type ContractType } from "./contracts";

/**
 * Nomor kontrak berurut per tipe per tahun ("0007/PKWT/VII/2026").
 * `insert` dipanggil ulang sekali dengan nomor berikutnya bila kena balapan
 * unique constraint contract_number.
 */
export async function nextContractNumber(type: ContractType): Promise<string> {
  const row = await queryOne<{ count: string }>(
    `SELECT count(*) FROM hris.employment_contracts
     WHERE contract_type = $1
       AND date_part('year', created_at) = date_part('year', now())`,
    [type]
  );
  return buildContractNumber(type, Number(row?.count ?? 0) + 1, new Date());
}

export function isContractNumberConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("employment_contracts_contract_number_key")
  );
}

/** Jalankan insert dengan nomor kontrak; retry sekali bila nomor bentrok. */
export async function withContractNumber<T>(
  type: ContractType,
  insert: (contractNumber: string) => Promise<T>
): Promise<T> {
  const first = await nextContractNumber(type);
  try {
    return await insert(first);
  } catch (error) {
    if (!isContractNumberConflict(error)) throw error;
    const retry = await nextContractNumber(type);
    return insert(retry);
  }
}

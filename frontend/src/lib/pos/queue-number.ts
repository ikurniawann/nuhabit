import type { DbClient } from "@/lib/pg/types";

export function formatQueueNumber(seq: number): string {
  const n = Math.floor(Number(seq));
  return String(Math.max(1, Number.isFinite(n) ? n : 1)).padStart(3, "0");
}

export function shouldAllocateQueueNumber(existing?: string | null): boolean {
  return !String(existing || "").trim();
}

export async function allocateQueueNumber(
  db: DbClient,
  companyId?: string | null,
  branchId?: string | null
): Promise<string | null> {
  const { data, error } = await db.rpc("generate_queue_number", {
    p_company_id: companyId || null,
    p_branch_id: branchId || null,
  });
  if (error || data == null) {
    console.error("[pos] generate_queue_number", error);
    return null;
  }
  return String(data);
}

export async function ensureQueueNumber(
  db: DbClient,
  order: {
    id: string;
    queue_number?: string | null;
    company_id?: string | null;
    branch_id?: string | null;
  }
): Promise<string | null> {
  if (!shouldAllocateQueueNumber(order.queue_number)) {
    return String(order.queue_number).trim();
  }
  const queueNumber = await allocateQueueNumber(
    db,
    order.company_id,
    order.branch_id
  );
  if (!queueNumber) return null;
  const { error } = await db
    .from("pos_orders")
    .update({ queue_number: queueNumber })
    .eq("id", order.id);
  if (error) {
    console.error("[pos] ensureQueueNumber update", error);
    return null;
  }
  return queueNumber;
}

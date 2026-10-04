import type { PosPaymentMethod } from "@/lib/pos/payment-methods";

async function parseError(res: Response, fallback: string): Promise<never> {
  let message = fallback;
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    message = body.error ?? body.message ?? fallback;
  } catch {
    // ignore
  }
  throw new Error(message);
}

export async function fetchPaymentMethods(activeOnly = false) {
  const qs = activeOnly ? "?active=1" : "";
  const res = await fetch(`/api/pos/payment-methods${qs}`);
  if (!res.ok) await parseError(res, "Gagal memuat metode bayar");
  const body = (await res.json()) as { data: PosPaymentMethod[] };
  return body.data;
}

export async function updatePaymentMethod(input: {
  code: string;
  name?: string;
  description?: string;
  is_active?: boolean;
  sort_order?: number;
  new_code?: string;
}) {
  const res = await fetch("/api/pos/payment-methods", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) await parseError(res, "Gagal memperbarui metode bayar");
  const body = (await res.json()) as { data: PosPaymentMethod };
  return body.data;
}

export async function createPaymentMethod(input: {
  name: string;
  code?: string;
  description?: string;
  handler: "cash" | "credit";
}) {
  const res = await fetch("/api/pos/payment-methods", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) await parseError(res, "Gagal menambah metode bayar");
  const body = (await res.json()) as { data: PosPaymentMethod };
  return body.data;
}

export async function deletePaymentMethod(code: string) {
  const res = await fetch(
    `/api/pos/payment-methods?code=${encodeURIComponent(code)}`,
    { method: "DELETE" }
  );
  if (!res.ok) await parseError(res, "Gagal menghapus metode bayar");
  return true;
}

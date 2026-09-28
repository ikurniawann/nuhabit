import type { PaymentGatewayPublic, StaticQrisConfig, UpdatePaymentGatewayPayload } from "./types";

async function parseJson<T>(res: Response): Promise<T> {
  const json = (await res.json()) as T & { success?: boolean; error?: string; message?: string };
  if (!res.ok || (json as { success?: boolean }).success === false) {
    throw new Error(
      (json as { error?: string }).error ||
        (json as { message?: string }).message ||
        `Request failed (${res.status})`
    );
  }
  return json;
}

export async function listPaymentGateways(): Promise<PaymentGatewayPublic[]> {
  const res = await fetch("/api/settings/payment-gateways", {
    credentials: "include",
    cache: "no-store",
  });
  const json = await parseJson<{ data: PaymentGatewayPublic[] }>(res);
  return json.data ?? [];
}

export async function updatePaymentGateway(
  payload: UpdatePaymentGatewayPayload
): Promise<PaymentGatewayPublic> {
  const res = await fetch("/api/settings/payment-gateways", {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await parseJson<{ data: PaymentGatewayPublic }>(res);
  return json.data;
}

export async function getStaticQris(): Promise<StaticQrisConfig> {
  const res = await fetch("/api/settings/static-qris", { credentials: "include", cache: "no-store" });
  return (await parseJson<{ data: StaticQrisConfig }>(res)).data;
}

export async function uploadStaticQris(file: File): Promise<StaticQrisConfig> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch("/api/settings/static-qris", { method: "POST", credentials: "include", body });
  return (await parseJson<{ data: StaticQrisConfig }>(res)).data;
}

export async function setStaticQrisEnabled(enabled: boolean): Promise<StaticQrisConfig> {
  const res = await fetch("/api/settings/static-qris", {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  return (await parseJson<{ data: StaticQrisConfig }>(res)).data;
}

export async function removeStaticQris(): Promise<StaticQrisConfig> {
  const res = await fetch("/api/settings/static-qris", { method: "DELETE", credentials: "include" });
  return (await parseJson<{ data: StaticQrisConfig }>(res)).data;
}

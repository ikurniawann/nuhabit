import { apiGet, apiPatch } from "@/lib/api-client";

export interface GatewayState {
  configured: boolean;
  reachable?: boolean;
  status: {
    connected: boolean;
    phone: string | null;
    needsPairing: boolean;
    lastConnectedAt: string | null;
    lastDisconnectReason: string | null;
  } | null;
  qr: string | null;
  settings?: {
    url: string;
    token_masked: string | null;
    token_from_env: boolean;
  };
}

export const fetchGatewayState = () =>
  apiGet<{ data: GatewayState }>("/api/settings/wa-gateway").then(
    (r) => r.data,
  );

export const saveGatewayConfig = (body: { url: string; token?: string }) =>
  apiPatch<{ data: { configured: boolean; reachable: boolean } }>(
    "/api/settings/wa-gateway",
    body,
  ).then((r) => r.data);

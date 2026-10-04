import { apiDelete, apiGet, apiPut } from "@/lib/api-client";

export interface InstagramConfig {
  verify_token: string;
  account_id: string;
  has_app_secret: boolean;
  app_secret_masked: string | null;
  has_access_token: boolean;
  access_token_masked: string | null;
  webhook_ready: boolean;
  configured: boolean;
}

export type InstagramCredentials = {
  app_secret: string;
  verify_token: string;
  access_token: string;
  account_id: string;
};

const BASE = "/api/settings/instagram";

export const fetchInstagramConfig = () =>
  apiGet<{ data: InstagramConfig }>(BASE).then((r) => r.data);
export const saveInstagramConfig = (body: InstagramCredentials) =>
  apiPut(BASE, body);
export const deleteInstagramConfig = () => apiDelete(BASE);

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptGofoodOrder,
  clearGobizTokenCache,
  getGobizAccessToken,
  GobizApiError,
  markGofoodFoodReady,
  rejectGofoodOrder,
} from "./client";
import type { GobizConfig } from "./config";

const config: GobizConfig = {
  enabled: true,
  environment: "sandbox",
  clientId: "cid",
  clientSecret: "sec",
  outletId: "G123",
  webhookToken: "tok",
  autoAccept: false,
  partnerId: "",
  relaySecret: "",
  enforceSignature: false,
  apiBase: "https://api.partner-sandbox.gobiz.co.id",
  oauthUrl: "https://integration-goauth.gojekapi.com/oauth2/token",
};

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

beforeEach(() => clearGobizTokenCache());

describe("getGobizAccessToken", () => {
  it("meminta token client_credentials (form-urlencoded) dan meng-cache sampai hampir kedaluwarsa", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { access_token: "T1", expires_in: 3599 }));
    let now = 1_000_000;
    const token1 = await getGobizAccessToken(config, fetchImpl, () => now);
    const token2 = await getGobizAccessToken(config, fetchImpl, () => now + 1000);
    expect(token1).toBe("T1");
    expect(token2).toBe("T1");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(config.oauthUrl);
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(String(init.body)).toContain("grant_type=client_credentials");
    expect(String(init.body)).toContain("client_id=cid");
    expect(String(init.body)).toContain("scope=gofood%3Acatalog%3Awrite");

    now += (3599 - 60) * 1000 + 1; // lewat batas refresh
    await getGobizAccessToken(config, fetchImpl, () => now);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("gagal → GobizApiError dgn pesan dari GoBiz", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401, { error: "invalid_client", error_description: "Client salah" }));
    await expect(getGobizAccessToken(config, fetchImpl)).rejects.toMatchObject({
      name: "GobizApiError",
      status: 401,
      message: "Client salah",
    });
  });
});

describe("order endpoints", () => {
  function fetchWithToken(handler: (url: string, init: RequestInit) => Response) {
    return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (target === config.oauthUrl) return jsonResponse(200, { access_token: "T", expires_in: 3599 });
      return handler(target, init ?? {});
    });
  }

  it("accept → PUT …/orders/{type}/{id}/accepted dgn body {} dan Bearer", async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const fetchImpl = fetchWithToken((url, init) => {
      seen.url = url;
      seen.init = init;
      return jsonResponse(200, { success: true, data: {} });
    });
    await acceptGofoodOrder(config, "delivery", "F-1", fetchImpl as unknown as typeof fetch);
    expect(seen.url).toBe(`${config.apiBase}/integrations/gofood/outlets/G123/v1/orders/delivery/F-1/accepted`);
    expect(seen.init?.method).toBe("PUT");
    expect(seen.init?.body).toBe("{}");
    expect((seen.init?.headers as Record<string, string>).Authorization).toBe("Bearer T");
  });

  it("reject → …/cancelled dgn cancel_reason_code + description; food ready → …/food-prepared {country_code:ID}", async () => {
    const bodies: Record<string, unknown> = {};
    const fetchImpl = fetchWithToken((url, init) => {
      bodies[url] = JSON.parse(String(init.body));
      return jsonResponse(200, { success: true, data: {} });
    });
    await rejectGofoodOrder(config, "pickup", "F-2", { code: "ITEMS_OUT_OF_STOCK", description: "Habis" }, fetchImpl as unknown as typeof fetch);
    await markGofoodFoodReady(config, "pickup", "F-2", fetchImpl as unknown as typeof fetch);
    expect(bodies[`${config.apiBase}/integrations/gofood/outlets/G123/v1/orders/pickup/F-2/cancelled`]).toEqual({
      cancel_reason_code: "ITEMS_OUT_OF_STOCK",
      cancel_reason_description: "Habis",
    });
    expect(bodies[`${config.apiBase}/integrations/gofood/outlets/G123/v1/orders/pickup/F-2/food-prepared`]).toEqual({
      country_code: "ID",
    });
  });

  it("respons 404 → GobizApiError; 401 membuang cache token", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target === config.oauthUrl) {
        calls += 1;
        return jsonResponse(200, { access_token: `T${calls}`, expires_in: 3599 });
      }
      return jsonResponse(401, { message: "Unauthorized" });
    });
    await expect(acceptGofoodOrder(config, "delivery", "F-3", fetchImpl as unknown as typeof fetch)).rejects.toBeInstanceOf(GobizApiError);
    await expect(acceptGofoodOrder(config, "delivery", "F-3", fetchImpl as unknown as typeof fetch)).rejects.toBeInstanceOf(GobizApiError);
    expect(calls).toBe(2); // token diminta ulang setelah 401
  });
});

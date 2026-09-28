import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { getSettings, maskSecret, SETTING_KEYS, setSetting } from "@/lib/settings/app-settings";
import {
  ensureWebhookToken,
  gobizWebhookUrl,
  isGobizConfigured,
  loadGobizConfig,
  resolveGobizUrls,
} from "@/lib/gobiz/config";

/**
 * GET/PUT /api/settings/gobiz — konfigurasi integrasi GoBiz/GoFood (EPIC-049).
 * Secret dimask di GET; string kosong di PUT = hapus, undefined = tidak diubah.
 */

function appUrl(request: NextRequest) {
  return process.env.NEXT_PUBLIC_APP_URL?.trim() || request.nextUrl.origin;
}

export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.settingsIntegrations);
    const config = await loadGobizConfig();
    const raw = await getSettings([SETTING_KEYS.GOBIZ_OAUTH_URL, SETTING_KEYS.GOBIZ_API_BASE_URL]);
    const token = config.webhookToken || (await ensureWebhookToken());
    const last = await import("@/lib/db").then(({ queryOne }) =>
      queryOne<{ created_at: string; status: string; item_count: number; error: string | null }>(
        `SELECT created_at, status, item_count, error FROM pos.gofood_catalog_syncs ORDER BY created_at DESC LIMIT 1`
      ).catch(() => null)
    );
    return NextResponse.json({
      data: {
        enabled: config.enabled,
        environment: config.environment,
        client_id: config.clientId,
        client_secret_masked: maskSecret(config.clientSecret || null),
        has_client_secret: Boolean(config.clientSecret),
        outlet_id: config.outletId,
        partner_id: config.partnerId,
        relay_secret_masked: maskSecret(config.relaySecret || null),
        has_relay_secret: Boolean(config.relaySecret),
        enforce_signature: config.enforceSignature,
        auto_accept: config.autoAccept,
        oauth_url: raw[SETTING_KEYS.GOBIZ_OAUTH_URL] || "",
        api_base_url: raw[SETTING_KEYS.GOBIZ_API_BASE_URL] || "",
        effective_urls: resolveGobizUrls(config.environment, {
          apiBase: raw[SETTING_KEYS.GOBIZ_API_BASE_URL],
          oauthUrl: raw[SETTING_KEYS.GOBIZ_OAUTH_URL],
        }),
        webhook_url: gobizWebhookUrl(appUrl(request), token),
        configured: isGobizConfigured(config),
        last_catalog_sync: last,
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[settings/gobiz] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const putSchema = z.object({
  enabled: z.boolean().optional(),
  environment: z.enum(["sandbox", "production"]).optional(),
  client_id: z.string().max(200).optional(),
  client_secret: z.string().max(500).optional(),
  outlet_id: z.string().max(200).optional(),
  partner_id: z.string().max(200).optional(),
  relay_secret: z.string().max(500).optional(),
  enforce_signature: z.boolean().optional(),
  auto_accept: z.boolean().optional(),
  oauth_url: z.string().max(500).optional(),
  api_base_url: z.string().max(500).optional(),
});

export async function PUT(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.settingsIntegrations);
    const parsed = putSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Data tidak valid" }, { status: 400 });
    const body = parsed.data;

    const writes: Array<[string, string | null]> = [];
    if (body.enabled !== undefined) writes.push([SETTING_KEYS.GOBIZ_ENABLED, body.enabled ? "true" : "false"]);
    if (body.environment !== undefined) writes.push([SETTING_KEYS.GOBIZ_ENVIRONMENT, body.environment]);
    if (body.client_id !== undefined) writes.push([SETTING_KEYS.GOBIZ_CLIENT_ID, body.client_id.trim() || null]);
    if (body.client_secret !== undefined) writes.push([SETTING_KEYS.GOBIZ_CLIENT_SECRET, body.client_secret.trim() || null]);
    if (body.outlet_id !== undefined) writes.push([SETTING_KEYS.GOBIZ_OUTLET_ID, body.outlet_id.trim() || null]);
    if (body.partner_id !== undefined) writes.push([SETTING_KEYS.GOBIZ_PARTNER_ID, body.partner_id.trim() || null]);
    if (body.relay_secret !== undefined) writes.push([SETTING_KEYS.GOBIZ_RELAY_SECRET, body.relay_secret.trim() || null]);
    if (body.enforce_signature !== undefined) {
      writes.push([SETTING_KEYS.GOBIZ_SIGNATURE_ENFORCE, body.enforce_signature ? "true" : "false"]);
    }
    if (body.auto_accept !== undefined) writes.push([SETTING_KEYS.GOBIZ_AUTO_ACCEPT, body.auto_accept ? "true" : "false"]);
    if (body.oauth_url !== undefined) {
      if (body.oauth_url.trim() && !/^https:\/\//.test(body.oauth_url.trim())) {
        return NextResponse.json({ error: "OAuth URL harus https" }, { status: 400 });
      }
      writes.push([SETTING_KEYS.GOBIZ_OAUTH_URL, body.oauth_url.trim() || null]);
    }
    if (body.api_base_url !== undefined) {
      if (body.api_base_url.trim() && !/^https:\/\//.test(body.api_base_url.trim())) {
        return NextResponse.json({ error: "API base URL harus https" }, { status: 400 });
      }
      writes.push([SETTING_KEYS.GOBIZ_API_BASE_URL, body.api_base_url.trim() || null]);
    }
    for (const [key, value] of writes) await setSetting(key, value);
    await ensureWebhookToken();

    return GET(request);
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[settings/gobiz] PUT failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
